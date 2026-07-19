import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, AuthenticationError, InternalServerError, RateLimitError } from 'openai';
import type { FunctionTool, Response, ResponseStreamEvent, ResponseUsage, ToolChoiceOptions } from 'openai/resources/responses/responses';
import type * as vscode from 'vscode';
import type { ReasoningEffort } from './config.js';
import type { ResponsesInputMessage } from './convertMessages.js';
import { normalizeBaseURL } from './urlUtils.js';

const OPENAI_DEFAULT_MAX_RETRIES = 2;
const OPENAI_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const LANGUAGE_MODEL_CHAT_TOOL_MODE_AUTO = 1;
const LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED = 2;
const MAX_FUNCTION_TOOL_NAME_LENGTH = 64;

export interface CodexReasoning {
  effort: ReasoningEffort;
}

export interface ResponsesRequestOptions {
  omitMaxOutputTokens?: boolean;
  model: string;
  instructions: string;
  serviceTier?: 'default' | 'priority';
  input: ResponsesInputMessage[];
  tools?: readonly vscode.LanguageModelChatTool[];
  toolMode?: vscode.LanguageModelChatToolMode;
  reasoning?: CodexReasoning;
  maxOutputTokens: number;
}

export interface ResponseStreamCallbacks {
  onTextDelta: (text: string) => void;
  onReasoningTextDelta?: (text: string) => void;
  onReasoningSummaryDelta?: (text: string) => void;
  onRefusalDelta?: (text: string) => void;
  onToolCall?: (callId: string, name: string, input: object) => void;
  onResponseCreated?: (response: { id?: string; status?: string; service_tier?: string | null }) => void;
  onResponseCompleted?: (response: { id?: string; usage?: ResponseUsage | null }) => void;
  onResponseFailed?: (message: string) => void;
  onResponseIncomplete?: (message: string, response: { id?: string; incomplete_details?: Response['incomplete_details'] }) => void;
  onResponseError?: (message: string, code?: string | null, param?: string | null) => void;
  onCancelled?: () => void;
  onUnhandledEvent?: (eventType: string) => void;
}

export interface ResponseStreamCancellation {
  isCancellationRequested(): boolean;
  cancel(): void;
}

export interface StreamResponseTextOptions extends ResponsesRequestOptions, ResponseStreamCallbacks {
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  token: vscode.CancellationToken;
}

export interface CountInputTokensOptions {
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  model: string;
  input: string | ResponsesInputMessage[];
  token: vscode.CancellationToken;
}

export type ResponsesErrorKind = 'noPermissions' | 'notFound' | 'blocked' | 'transport' | 'server' | 'failed' | 'incomplete' | 'malformed';

export class ResponsesTransportError extends Error {
  readonly kind: ResponsesErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(kind: ResponsesErrorKind, message: string, options: { cause?: unknown; status?: number; code?: string | null } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ResponsesTransportError';
    this.kind = kind;
    this.status = options.status;
    this.code = options.code ?? undefined;
  }
}

export type ResponsesCreateRequest = ReturnType<typeof buildResponsesCreateRequest>;

export function buildResponsesCreateRequest(options: ResponsesRequestOptions) {
  const tools = convertTools(options.tools ?? []);
  const toolChoice = mapToolChoice(options.toolMode, tools.length);
  return {
    model: options.model,
    instructions: options.instructions,
    input: options.input,
    stream: true,
    store: false,
    ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    ...(tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
    ...(options.omitMaxOutputTokens ? {} : { max_output_tokens: options.maxOutputTokens })
  } as const;
}

export async function streamResponseText(options: StreamResponseTextOptions): Promise<void> {
  const abortController = new AbortController();
  let cancellationReported = false;
  const reportCancellation = () => {
    if (!cancellationReported) {
      cancellationReported = true;
      options.onCancelled?.();
    }
  };
  const cancellation = options.token.onCancellationRequested(() => {
    abortController.abort();
    reportCancellation();
  });
  try {
    if (options.token.isCancellationRequested) {
      abortController.abort();
      reportCancellation();
      return;
    }
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

    const stream = await client.responses.create(request as unknown as Parameters<typeof client.responses.create>[0], {
      signal: abortController.signal,
      maxRetries: OPENAI_DEFAULT_MAX_RETRIES,
      timeout: OPENAI_DEFAULT_TIMEOUT_MS
    }) as AsyncIterable<ResponseStreamEvent>;

    await consumeResponseStreamEvents(stream, options, {
      isCancellationRequested: () => options.token.isCancellationRequested,
      cancel: () => {
        abortController.abort();
        reportCancellation();
      }
    });
  } catch (error) {
    if (options.token.isCancellationRequested || abortController.signal.aborted) {
      reportCancellation();
      return;
    }
    throw normalizeResponsesError(error, options.baseURL);
  } finally {
    cancellation.dispose();
  }
}

export type ResponseStreamEventOutcome = 'continue' | 'completed';

/**
 * Consumes a Responses event stream independently of the network client. This
 * keeps lifecycle behavior deterministic and directly testable with a mocked
 * AsyncIterable while the production caller retains ownership of aborting I/O.
 */
export async function consumeResponseStreamEvents(
  stream: AsyncIterable<ResponseStreamEvent>,
  callbacks: ResponseStreamCallbacks,
  cancellation: ResponseStreamCancellation
): Promise<void> {
  let completed = false;
  for await (const event of stream) {
    if (cancellation.isCancellationRequested()) {
      cancellation.cancel();
      return;
    }
    if (handleResponseStreamEvent(event, callbacks) === 'completed') {
      completed = true;
    }
  }
  if (!completed && !cancellation.isCancellationRequested()) {
    throw new ResponsesTransportError('malformed', 'Responses API stream ended without a terminal event.');
  }
}

export function handleResponseStreamEvent(event: ResponseStreamEvent, callbacks: ResponseStreamCallbacks): ResponseStreamEventOutcome {
  switch (event.type) {
    case 'response.output_text.delta':
      callbacks.onTextDelta(event.delta);
      return 'continue';
    case 'response.reasoning_summary_text.delta':
      (callbacks.onReasoningSummaryDelta ?? callbacks.onReasoningTextDelta)?.(event.delta);
      return 'continue';
    case 'response.reasoning_text.delta':
      callbacks.onReasoningTextDelta?.(event.delta);
      return 'continue';
    case 'response.refusal.delta':
      (callbacks.onRefusalDelta ?? callbacks.onTextDelta)(event.delta);
      return 'continue';
    case 'response.output_item.done':
      if (event.item.type === 'function_call') {
        callbacks.onToolCall?.(event.item.call_id, event.item.name, parseToolCallInput(event.item.arguments));
      }
      return 'continue';
    case 'response.created':
      callbacks.onResponseCreated?.(event.response);
      return 'continue';
    case 'response.completed':
      callbacks.onResponseCompleted?.(event.response);
      return 'completed';
    case 'response.failed': {
      const message = event.response.error?.message ?? 'Responses API request failed.';
      const code = event.response.error?.code;
      callbacks.onResponseFailed?.(message);
      throw new ResponsesTransportError(classifyErrorDetails(undefined, code, message), message, {
        code,
        cause: event
      });
    }
    case 'response.incomplete': {
      const reason = event.response.incomplete_details?.reason;
      const message = `Responses API request was incomplete${reason ? `: ${reason}` : ''}.`;
      callbacks.onResponseIncomplete?.(message, event.response);
      throw new ResponsesTransportError('incomplete', message, { cause: event });
    }
    case 'error':
      callbacks.onResponseError?.(event.message, event.code, event.param);
      throw new ResponsesTransportError(classifyErrorDetails(undefined, event.code ?? undefined, event.message), event.message, {
        code: event.code,
        cause: event
      });
    case 'response.output_text.done':
    case 'response.reasoning_summary_text.done':
    case 'response.reasoning_text.done':
    case 'response.refusal.done':
    case 'response.function_call_arguments.delta':
    case 'response.function_call_arguments.done':
      return 'continue';
    default:
      callbacks.onUnhandledEvent?.(event.type);
      return 'continue';
  }
}

export async function countInputTokens(options: CountInputTokensOptions): Promise<number> {
  const endpoint = `${normalizeBaseURL(options.baseURL)}/responses/input_tokens`;
  const cancellation = bindCancellationToken(options.token);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        ...options.headers
      },
      body: JSON.stringify({ model: options.model, input: options.input }),
      signal: cancellation.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw createHttpError(response.status, response.statusText, body, endpoint);
    }
    const payload = await response.json() as { input_tokens?: unknown };
    if (typeof payload.input_tokens !== 'number' || !Number.isFinite(payload.input_tokens) || payload.input_tokens < 0) {
      throw new ResponsesTransportError('malformed', 'Responses input token count returned an invalid input_tokens value.');
    }
    return Math.floor(payload.input_tokens);
  } catch (error) {
    if (options.token.isCancellationRequested) {
      throw error;
    }
    throw normalizeResponsesError(error, options.baseURL, '/responses/input_tokens');
  } finally {
    cancellation.dispose();
  }
}

function convertTools(tools: readonly vscode.LanguageModelChatTool[]): FunctionTool[] {
  const names = new Set<string>();
  return tools.map((tool) => {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate language model tool name "${tool.name}".`);
    }
    names.add(tool.name);
    return convertToolToResponseTool(tool);
  });
}

function convertToolToResponseTool(tool: vscode.LanguageModelChatTool): FunctionTool {
  if (!isValidFunctionToolName(tool.name)) {
    throw new Error(`Invalid language model tool name "${tool.name}". Tool names must contain 1-${MAX_FUNCTION_TOOL_NAME_LENGTH} letters, digits, underscores, or dashes.`);
  }
  if (tool.inputSchema !== undefined && tool.inputSchema !== null && !isObjectRecord(tool.inputSchema)) {
    throw new Error(`Invalid input schema for language model tool "${tool.name}": the schema must be a JSON object.`);
  }
  if (isObjectRecord(tool.inputSchema)) {
    assertJsonValue(tool.inputSchema, `input schema for language model tool "${tool.name}"`);
  }
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: isObjectRecord(tool.inputSchema) ? tool.inputSchema : null,
    strict: false
  };
}

function isValidFunctionToolName(name: string): boolean {
  return name.length <= MAX_FUNCTION_TOOL_NAME_LENGTH && /^[A-Za-z0-9_-]+$/.test(name);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapToolChoice(toolMode: vscode.LanguageModelChatToolMode | undefined, toolCount: number): ToolChoiceOptions {
  if (toolMode === LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED && toolCount === 0) {
    throw new Error('Language model tool mode Required requires at least one tool.');
  }
  if (toolMode === undefined || toolMode === LANGUAGE_MODEL_CHAT_TOOL_MODE_AUTO) {
    return 'auto';
  }
  if (toolMode === LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED) {
    return 'required';
  }
  throw new Error(`Unsupported language model tool mode: ${String(toolMode)}.`);
}

export function parseToolCallInput(argumentsJson: string): object {
  if (!argumentsJson.trim()) {
    throw new ResponsesTransportError('malformed', 'Responses API returned empty function-call arguments; expected a JSON object.');
  }
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (!isObjectRecord(parsed)) {
      throw new Error('tool arguments must decode to a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new ResponsesTransportError('malformed', 'Responses API returned malformed function-call arguments.', {
      cause: error
    });
  }
}

export function classifyResponsesError(error: unknown): ResponsesErrorKind {
  if (error instanceof ResponsesTransportError) {
    return error.kind;
  }
  if (error instanceof APIConnectionError || getErrorName(error) === 'AbortError') {
    return 'transport';
  }
  const status = getErrorStatus(error);
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return classifyErrorDetails(status, code, message);
}

export function normalizeResponsesError(error: unknown, baseURL: string, resourcePath = '/responses'): Error {
  if (error instanceof ResponsesTransportError) {
    return error;
  }
  const endpoint = `${normalizeBaseURL(baseURL)}${resourcePath}`;
  if (error instanceof APIConnectionTimeoutError) {
    return new ResponsesTransportError('transport', `OpenAI request timed out while contacting ${endpoint}.`, { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new ResponsesTransportError('transport', `Connection failure while contacting ${endpoint}. ${getCauseMessage(error) ?? ''}`.trim(), { cause: error });
  }
  if (error instanceof AuthenticationError) {
    return new ResponsesTransportError('noPermissions', `Responses API authentication failed. Check the stored API key or ~/.codex/auth.json credentials. ${error.message}`, {
      cause: error,
      status: error.status,
      code: error.code
    });
  }
  if (error instanceof RateLimitError) {
    return new ResponsesTransportError('blocked', `OpenAI rate limit or quota exceeded while contacting ${endpoint}. ${error.message}`, {
      cause: error,
      status: error.status,
      code: error.code
    });
  }
  if (error instanceof InternalServerError || error instanceof APIError) {
    return new ResponsesTransportError(classifyResponsesError(error), `OpenAI request failed while contacting ${endpoint}. ${error.message}`, {
      cause: error,
      status: error.status,
      code: error.code
    });
  }
  return error instanceof Error ? error : new Error(String(error));
}

function classifyErrorDetails(status: number | undefined, code: string | undefined, message: string): ResponsesErrorKind {
  const normalizedCode = code?.trim().toLowerCase();
  if (status === 401 || status === 403 || normalizedCode !== undefined && [
    'invalid_api_key',
    'authentication_error',
    'permission_denied',
    'insufficient_permissions',
    'unauthorized',
    'forbidden'
  ].includes(normalizedCode)) {
    return 'noPermissions';
  }
  if (status === 429 || normalizedCode !== undefined && [
    'rate_limit_exceeded',
    'insufficient_quota',
    'quota_exceeded',
    'billing_hard_limit_reached',
    'usage_limit_reached'
  ].includes(normalizedCode)) {
    return 'blocked';
  }
  if (status === 404 && isModelSpecificError(code, message)) {
    return 'notFound';
  }
  if (status !== undefined && status >= 500) {
    return 'server';
  }
  return 'failed';
}

function isModelSpecificError(code: string | undefined, message: string): boolean {
  return code === 'model_not_found'
    || code === 'model_not_available'
    || /\bmodel\b[^.\n]*(not found|does not exist|unavailable|not available)/i.test(message);
}

function createHttpError(status: number, statusText: string, body: string, endpoint: string): ResponsesTransportError {
  const details = readHttpErrorDetails(body);
  const suffix = body ? ` ${body}` : '';
  return new ResponsesTransportError(
    classifyErrorDetails(status, details.code, details.message || body),
    `Responses request to ${endpoint} failed with ${status} ${statusText}.${suffix}`,
    { status, code: details.code }
  );
}

function readHttpErrorDetails(body: string): { code?: string; message: string } {
  try {
    const payload = JSON.parse(body) as unknown;
    if (isObjectRecord(payload)) {
      const nested = isObjectRecord(payload.error) ? payload.error : payload;
      return {
        code: typeof nested.code === 'string' ? nested.code : undefined,
        message: typeof nested.message === 'string' ? nested.message : ''
      };
    }
  } catch {
    // Non-JSON error bodies are retained verbatim in the caller's message.
  }
  return { message: '' };
}

function assertJsonValue(value: unknown, label: string, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label}: numbers must be finite.`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`Invalid ${label}: values must be JSON-serializable.`);
  }
  if (ancestors.has(value)) {
    throw new Error(`Invalid ${label}: cyclic values are not supported.`);
  }
  ancestors.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [, child] of entries) {
    assertJsonValue(child, label, ancestors);
  }
  ancestors.delete(value);
}

function getErrorStatus(error: unknown): number | undefined {
  return isObjectRecord(error) && typeof error.status === 'number' ? error.status : undefined;
}

function getErrorCode(error: unknown): string | undefined {
  return isObjectRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : isObjectRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

function getErrorName(error: unknown): string | undefined {
  return isObjectRecord(error) && typeof error.name === 'string' ? error.name : undefined;
}

function getCauseMessage(error: Error & { cause?: unknown }): string | undefined {
  if (error.cause instanceof Error && error.cause.message.trim()) {
    return error.cause.message.trim();
  }
  return typeof error.cause === 'string' && error.cause.trim() ? error.cause.trim() : undefined;
}

function bindCancellationToken(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
    return { signal: controller.signal, dispose: () => undefined };
  }
  const cancellation = token.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => cancellation.dispose() };
}
