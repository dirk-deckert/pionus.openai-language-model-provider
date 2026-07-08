import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, AuthenticationError, InternalServerError, RateLimitError } from 'openai';
import type { FunctionTool, ResponseUsage, ToolChoiceOptions } from 'openai/resources/responses/responses';
import type { Reasoning } from 'openai/resources/shared';
import type * as vscode from 'vscode';
import type { ResponsesInputMessage } from './convertMessages.js';
import { normalizeBaseURL } from './urlUtils.js';

const OPENAI_DEFAULT_MAX_RETRIES = 2;
const OPENAI_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED = 2;

export interface StreamResponseTextOptions {
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  omitMaxOutputTokens?: boolean;
  model: string;
  instructions: string;
  serviceTier?: 'default' | 'priority';
  input: ResponsesInputMessage[];
  tools?: readonly vscode.LanguageModelChatTool[];
  toolMode?: vscode.LanguageModelChatToolMode;
  reasoning?: Reasoning;
  maxOutputTokens: number;
  previousResponseId?: string;
  token: vscode.CancellationToken;
  onTextDelta: (text: string) => void;
  onReasoningTextDelta?: (text: string) => void;
  onToolCall?: (callId: string, name: string, input: object) => void;
  onResponseCreated?: (response: { id?: string; status?: string; service_tier?: string | null }) => void;
  onResponseCompleted?: (response: { id?: string; usage?: ResponseUsage | null }) => void;
  onResponseFailed?: (message: string) => void;
  onUnhandledEvent?: (eventType: string) => void;
}

export interface CountInputTokensOptions {
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  model: string;
  input: string | ResponsesInputMessage[];
  token: vscode.CancellationToken;
}

export type ResponsesCreateRequest = ReturnType<typeof buildResponsesCreateRequest>;

export function buildResponsesCreateRequest(options: Omit<StreamResponseTextOptions, 'baseURL' | 'apiKey' | 'headers' | 'token' | 'onTextDelta' | 'onReasoningTextDelta' | 'onToolCall' | 'onResponseCreated' | 'onResponseCompleted' | 'onResponseFailed'>) {
  const tools = options.tools?.map(convertToolToResponseTool) ?? [];
  return {
    model: options.model,
    instructions: options.instructions,
    input: options.input,
    stream: true,
    store: tools.length > 0 || Boolean(options.previousResponseId),
    ...(options.previousResponseId ? { previous_response_id: options.previousResponseId } : {}),
    ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    ...(tools.length > 0 ? { tools, tool_choice: mapToolChoice(options.toolMode) } : {}),
    ...(options.omitMaxOutputTokens ? {} : { max_output_tokens: options.maxOutputTokens })
  } as const;
}

export async function streamResponseText(options: StreamResponseTextOptions): Promise<void> {
  const abortController = new AbortController();
  const cancellation = options.token.onCancellationRequested(() => abortController.abort());
  try {
    if (!options.instructions.trim()) {
      throw new Error('Codex requires non-empty top-level instructions.');
    }

    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: normalizeBaseURL(options.baseURL),
      defaultHeaders: options.headers,
      maxRetries: OPENAI_DEFAULT_MAX_RETRIES,
      timeout: OPENAI_DEFAULT_TIMEOUT_MS
    });

    const request = buildResponsesCreateRequest(options);

    const stream = await client.responses.create(request, {
      signal: abortController.signal,
      maxRetries: OPENAI_DEFAULT_MAX_RETRIES,
      timeout: OPENAI_DEFAULT_TIMEOUT_MS
    });

    for await (const event of stream) {
      if (options.token.isCancellationRequested) {
        abortController.abort();
        return;
      }
      if (event.type === 'response.output_text.delta') {
        options.onTextDelta(event.delta);
      } else if (event.type === 'response.reasoning_text.delta') {
        options.onReasoningTextDelta?.(event.delta);
      } else if (event.type === 'response.output_item.done' && event.item.type === 'function_call') {
        options.onToolCall?.(event.item.call_id, event.item.name, parseToolCallInput(event.item.arguments));
      } else if (event.type === 'response.created') {
        options.onResponseCreated?.(event.response);
      } else if (event.type === 'response.completed') {
        options.onResponseCompleted?.(event.response);
      } else if (event.type === 'response.failed') {
        const message = event.response.error?.message ?? 'Responses API request failed.';
        options.onResponseFailed?.(message);
        throw new Error(message);
      } else {
        options.onUnhandledEvent?.(event.type);
      }
    }
  } catch (error) {
    if (options.token.isCancellationRequested || abortController.signal.aborted) {
      return;
    }
    throw normalizeResponsesError(error, options.baseURL);
  } finally {
    cancellation.dispose();
  }
}

export async function countInputTokens(options: CountInputTokensOptions): Promise<number> {
  const response = await fetch(`${normalizeBaseURL(options.baseURL)}/responses/input_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
      ...options.headers
    },
    body: JSON.stringify({ model: options.model, input: options.input }),
    signal: toAbortSignal(options.token)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Responses input token count failed with ${response.status} ${response.statusText}.${body ? ` ${body}` : ''}`);
  }
  const payload = await response.json() as { input_tokens?: unknown };
  if (typeof payload.input_tokens !== 'number' || !Number.isFinite(payload.input_tokens) || payload.input_tokens < 0) {
    throw new Error('Responses input token count returned an invalid input_tokens value.');
  }
  return Math.floor(payload.input_tokens);
}

function convertToolToResponseTool(tool: vscode.LanguageModelChatTool): FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ? tool.inputSchema as Record<string, unknown> : null,
    strict: false
  };
}

function mapToolChoice(toolMode: vscode.LanguageModelChatToolMode | undefined): ToolChoiceOptions {
  return toolMode === LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED ? 'required' : 'auto';
}

function parseToolCallInput(argumentsJson: string): object {
  if (!argumentsJson.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return { _raw: argumentsJson };
  }
}

function normalizeResponsesError(error: unknown, baseURL: string): Error {
  const endpoint = `${normalizeBaseURL(baseURL)}/responses`;
  if (error instanceof APIConnectionTimeoutError) {
    return new Error(`OpenAI request timed out while contacting ${endpoint}.`, { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new Error(`Connection failure while contacting ${endpoint}. ${getCauseMessage(error) ?? ''}`.trim(), { cause: error });
  }
  if (error instanceof AuthenticationError) {
    return new Error(`Responses API authentication failed. Check the stored API key or ~/.codex/auth.json credentials. ${error.message}`, { cause: error });
  }
  if (error instanceof RateLimitError) {
    return new Error(`OpenAI rate limit exceeded while contacting ${endpoint}. ${error.message}`, { cause: error });
  }
  if (error instanceof InternalServerError || error instanceof APIError) {
    return new Error(`OpenAI request failed while contacting ${endpoint}. ${error.message}`, { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}

function getCauseMessage(error: Error & { cause?: unknown }): string | undefined {
  if (error.cause instanceof Error && error.cause.message.trim()) {
    return error.cause.message.trim();
  }
  return typeof error.cause === 'string' && error.cause.trim() ? error.cause.trim() : undefined;
}

function toAbortSignal(token: vscode.CancellationToken): AbortSignal | undefined {
  if (token.isCancellationRequested) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}
