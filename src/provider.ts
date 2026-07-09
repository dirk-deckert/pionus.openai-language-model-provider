import type { ResponseUsage } from 'openai/resources/responses/responses';
import * as vscode from 'vscode';
import { convertMessagesToResponsesInput, estimateTokenCount } from './convertMessages.js';
import { getConfigurationSection, getProviderConfig, normalizeReasoningEffort, type ProviderConfig, type ReasoningEffort } from './config.js';
import { buildFallbackModels, buildProviderModels, fetchAvailableModels, parseModelIdentifier, type ResolvedProviderModel } from './models.js';
import { countInputTokens, streamResponseText } from './responsesClient.js';
import { normalizeBaseURL } from './urlUtils.js';
import { getApiCredentials } from './secrets.js';
import { buildInstructions } from './instructions.js';
import { resolveAgentProfile } from './agentProfiles.js';
import { collectContextSnapshot, formatContextSnapshot } from './contextCollector.js';
import { buildActiveSkillInstructions } from './skills.js';

type RuntimeProvideLanguageModelChatResponseOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  readonly modelConfiguration?: Record<string, unknown>;
  readonly configuration?: Record<string, unknown>;
};

type VSCodeWithThinkingPart = typeof vscode & {
  LanguageModelThinkingPart?: new (value: string | string[], id?: string, metadata?: Record<string, unknown>) => unknown;
};

const USAGE_DATA_PART_MIME = 'usage';

export interface UsageSink {
  record(event: { model: string; usage: ResponseUsage; completedAt: number }): void;
}

interface RequestLogContext {
  readonly modelId: string;
  readonly requestModel: string;
  readonly serviceTier: string;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly agentProfile: string | null;
  readonly toolCount: number;
  readonly credentialSource: string;
  readonly startedAt: number;
}

interface StreamLogState {
  responseId?: string;
  createdStatus?: string;
  createdServiceTier?: string | null;
  textDeltaCount: number;
  textCharCount: number;
  reasoningDeltaCount: number;
  reasoningCharCount: number;
  toolCallCount: number;
  lastEventAt?: number;
  completed: boolean;
}

export class CodexModelProvider implements vscode.LanguageModelChatProvider {
  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void>;
  private readonly modelInfoChangedEmitter = new vscode.EventEmitter<void>();
  private cachedModels?: { key: string; expiresAt: number; models: ResolvedProviderModel[] };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.LogOutputChannel,
    private readonly usageSink?: UsageSink
  ) {
    this.onDidChangeLanguageModelChatInformation = this.modelInfoChangedEmitter.event;
    this.context.subscriptions.push(
      this.modelInfoChangedEmitter,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(getConfigurationSection())) {
          this.cachedModels = undefined;
          this.modelInfoChangedEmitter.fire();
        }
      })
    );
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const config = getProviderConfig();
    const credentials = await getApiCredentials(this.context);
    this.outputChannel.debug('provideLanguageModelChatInformation start', {
      silent: options.silent,
      baseURL: normalizeBaseURL(config.baseURL),
      hasCredentials: Boolean(credentials)
    });

    if (!credentials) {
      if (!options.silent) {
        await this.promptForCredentials();
      }
      return [];
    }

    const models = await this.getAvailableModels(config, credentials, token);
    return models.map((model) => model.info);
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const config = getProviderConfig();
    const credentials = await getApiCredentials(this.context);
    if (!credentials) {
      throw new Error('Codex credentials are missing. Run "Pionus Codex: Set API Key" or configure ~/.codex/auth.json.');
    }

    const parsedModel = parseModelIdentifier(model.id || config.model);
    const reasoningEffort = getReasoningEffort(parsedModel.reasoningEffort, options as RuntimeProvideLanguageModelChatResponseOptions, config.defaultReasoningEffort);
    const agentProfile = await resolveAgentProfile(config, { hasTools: Boolean(options.tools?.length), outputChannel: this.outputChannel });
    const skillInstructions = await buildActiveSkillInstructions(this.context, config, this.outputChannel);
    const ideContext = config.includeIdeContext ? formatContextSnapshot(collectContextSnapshot(config)) : undefined;
    const instructions = await buildInstructions(config, agentProfile, { ideContext, skillInstructions });
    const input = convertMessagesToResponsesInput(messages, false);
    const requestStartedAt = Date.now();
    const requestLogContext: RequestLogContext = {
      modelId: model.id,
      requestModel: parsedModel.requestModel,
      serviceTier: parsedModel.serviceTier ?? 'normal',
      reasoningEffort: reasoningEffort ?? null,
      agentProfile: agentProfile?.id ?? null,
      toolCount: options.tools?.length ?? 0,
      credentialSource: credentials.source,
      startedAt: requestStartedAt
    };
    const streamLogState: StreamLogState = {
      textDeltaCount: 0,
      textCharCount: 0,
      reasoningDeltaCount: 0,
      reasoningCharCount: 0,
      toolCallCount: 0,
      completed: false
    };
    const unhandledEventTypes = new Set<string>();

    this.outputChannel.info('provideLanguageModelChatResponse start', {
      ...toLogPayload(requestLogContext, streamLogState),
      messageCount: messages.length,
      inputItemCount: input.length,
      toolMode: options.toolMode ?? null,
      omitMaxOutputTokens: credentials.omitMaxOutputTokens
    });

    try {
      await streamResponseText({
        baseURL: config.baseURL,
        apiKey: credentials.apiKey,
        headers: credentials.headers,
        omitMaxOutputTokens: credentials.omitMaxOutputTokens,
        model: agentProfile?.model ?? parsedModel.requestModel,
        instructions,
        serviceTier: getRequestServiceTier(parsedModel.serviceTier),
        input,
        tools: options.tools,
        toolMode: options.toolMode,
        reasoning: reasoningEffort ? { effort: reasoningEffort } : agentProfile?.reasoningEffort ? { effort: agentProfile.reasoningEffort } : undefined,
        maxOutputTokens: config.maxOutputTokens,
        token,
        onTextDelta: (text) => {
          streamLogState.textDeltaCount += 1;
          streamLogState.textCharCount += text.length;
          streamLogState.lastEventAt = Date.now();
          progress.report(new vscode.LanguageModelTextPart(text));
        },
        onReasoningTextDelta: (text) => {
          streamLogState.reasoningDeltaCount += 1;
          streamLogState.reasoningCharCount += text.length;
          streamLogState.lastEventAt = Date.now();
          const thinkingPart = createThinkingPart(text);
          if (thinkingPart) {
            progress.report(thinkingPart);
          }
        },
        onToolCall: (callId, name, input) => {
          streamLogState.toolCallCount += 1;
          streamLogState.lastEventAt = Date.now();
          this.outputChannel.info('response tool call received', {
            ...toLogPayload(requestLogContext, streamLogState),
            callId,
            toolName: name,
            inputKeys: Object.keys(input).slice(0, 20)
          });
          progress.report(new vscode.LanguageModelToolCallPart(callId, name, input));
        },
        onResponseCreated: (response) => {
          streamLogState.responseId = response.id;
          streamLogState.createdStatus = response.status;
          streamLogState.createdServiceTier = response.service_tier;
          streamLogState.lastEventAt = Date.now();
          this.outputChannel.info('response created', {
            ...toLogPayload(requestLogContext, streamLogState),
            responseId: response.id,
            status: response.status,
            serviceTier: response.service_tier ?? null
          });
        },
        onResponseCompleted: (response) => {
          streamLogState.completed = true;
          streamLogState.responseId = response.id ?? streamLogState.responseId;
          streamLogState.lastEventAt = Date.now();
          this.outputChannel.info('response completed', {
            ...toLogPayload(requestLogContext, streamLogState),
            responseId: response.id,
            usage: response.usage ?? null
          });
          const usagePart = createUsageDataPart(response.usage);
          if (usagePart) {
            progress.report(usagePart);
          }
          if (response.usage) {
            this.usageSink?.record({ model: parsedModel.requestModel, usage: response.usage, completedAt: Date.now() });
          }
        },
        onResponseFailed: (message) => {
          streamLogState.lastEventAt = Date.now();
          this.outputChannel.error('response failed event', {
            ...toLogPayload(requestLogContext, streamLogState),
            message
          });
        },
        onUnhandledEvent: (eventType) => {
          streamLogState.lastEventAt = Date.now();
          if (unhandledEventTypes.has(eventType)) {
            return;
          }
          unhandledEventTypes.add(eventType);
          this.outputChannel.debug('response stream event ignored', {
            ...toLogPayload(requestLogContext, streamLogState),
            eventType
          });
        }
      });
    } catch (error) {
      this.outputChannel.error('provideLanguageModelChatResponse error', {
        ...toLogPayload(requestLogContext, streamLogState),
        error: describeError(error)
      });
      throw error;
    }

    if (token.isCancellationRequested) {
      this.outputChannel.warn('response cancelled', toLogPayload(requestLogContext, streamLogState));
    } else if (!streamLogState.completed) {
      this.outputChannel.warn('response stream ended without completed event', toLogPayload(requestLogContext, streamLogState));
    }
  }

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    const config = getProviderConfig();
    const credentials = await getApiCredentials(this.context);
    if (!credentials || !supportsOfficialTokenCounting(config.baseURL)) {
      return estimateTokenCount(text);
    }

    try {
      const parsedModel = parseModelIdentifier(model.id || config.model);
      const input = typeof text === 'string' ? text : convertMessagesToResponsesInput([text], false);
      return await countInputTokens({
        baseURL: config.baseURL,
        apiKey: credentials.apiKey,
        headers: credentials.headers,
        model: parsedModel.requestModel,
        input,
        token
      });
    } catch {
      return estimateTokenCount(text);
    }
  }

  async showStatus(): Promise<void> {
    const config = getProviderConfig();
    const credentials = await getApiCredentials(this.context);
    const agentProfile = await resolveAgentProfile(config, { hasTools: false, outputChannel: this.outputChannel });
    await vscode.window.showInformationMessage([
      `Pionus Codex: ${credentials ? `credentials from ${credentials.source}` : 'credentials missing'}`,
      `model ${config.model}`,
      `agent ${agentProfile?.id ?? 'none'}`
    ].join(' | '));
  }

  private async getAvailableModels(config: ProviderConfig, credentials: NonNullable<Awaited<ReturnType<typeof getApiCredentials>>>, token: vscode.CancellationToken): Promise<ResolvedProviderModel[]> {
    const cacheKey = [config.baseURL, config.clientVersion, config.model, config.defaultReasoningEffort, credentials.source].join('|');
    if (this.cachedModels && this.cachedModels.key === cacheKey && this.cachedModels.expiresAt > Date.now()) {
      return this.cachedModels.models;
    }

    let models: ResolvedProviderModel[];
    try {
      models = buildProviderModels(config, await fetchAvailableModels(config, credentials, token));
    } catch (error) {
      this.outputChannel.warn('getAvailableModels discovery failed, using fallback model', { error: error instanceof Error ? error.message : String(error) });
      models = buildFallbackModels(config);
    }
    this.cachedModels = { key: cacheKey, expiresAt: Date.now() + 60_000, models };
    return models;
  }

  private async promptForCredentials(): Promise<void> {
    const action = await vscode.window.showWarningMessage('Pionus Codex needs Codex credentials. Set an API key or add credentials to ~/.codex/auth.json.', 'Set API Key', 'Open Settings');
    if (action === 'Set API Key') {
      await vscode.commands.executeCommand('pionus.codex.setApiKey');
    } else if (action === 'Open Settings') {
      await vscode.commands.executeCommand('pionus.codex.openSettings');
    }
  }
}

function getRequestServiceTier(serviceTier: 'fast' | undefined): 'priority' | undefined {
  return serviceTier === 'fast' ? 'priority' : undefined;
}

function getReasoningEffort(selectedReasoningEffort: ReasoningEffort | undefined, options: RuntimeProvideLanguageModelChatResponseOptions, defaultReasoningEffort: ReasoningEffort | undefined): ReasoningEffort | undefined {
  return normalizeReasoningEffort(options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort)
    ?? normalizeReasoningEffort(options.modelOptions?.reasoningEffort)
    ?? normalizeReasoningEffort((options.modelOptions?.reasoning as { effort?: unknown } | undefined)?.effort)
    ?? defaultReasoningEffort
    ?? selectedReasoningEffort;
}

function supportsOfficialTokenCounting(baseURL: string): boolean {
  return !normalizeBaseURL(baseURL).toLowerCase().includes('chatgpt.com/backend-api/codex');
}

function createThinkingPart(text: string): vscode.LanguageModelResponsePart | undefined {
  const ThinkingPart = (vscode as VSCodeWithThinkingPart).LanguageModelThinkingPart;
  return typeof ThinkingPart === 'function' ? new ThinkingPart(text) as vscode.LanguageModelResponsePart : undefined;
}

function createUsageDataPart(usage: ResponseUsage | null | undefined): vscode.LanguageModelResponsePart | undefined {
  if (!usage) {
    return undefined;
  }
  return vscode.LanguageModelDataPart.json({
    prompt_tokens: usage.input_tokens ?? 0,
    completion_tokens: usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
    prompt_tokens_details: { cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0 },
    completion_tokens_details: { reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0 }
  }, USAGE_DATA_PART_MIME) as vscode.LanguageModelResponsePart;
}

function toLogPayload(context: RequestLogContext, state: StreamLogState): Record<string, unknown> {
  const now = Date.now();
  return {
    modelId: context.modelId,
    requestModel: context.requestModel,
    serviceTier: context.serviceTier,
    reasoningEffort: context.reasoningEffort,
    agentProfile: context.agentProfile,
    toolCount: context.toolCount,
    credentialSource: context.credentialSource,
    responseId: state.responseId ?? null,
    createdStatus: state.createdStatus ?? null,
    createdServiceTier: state.createdServiceTier ?? null,
    durationMs: now - context.startedAt,
    idleMs: state.lastEventAt ? now - state.lastEventAt : null,
    textDeltaCount: state.textDeltaCount,
    textCharCount: state.textCharCount,
    reasoningDeltaCount: state.reasoningDeltaCount,
    reasoningCharCount: state.reasoningCharCount,
    toolCallCount: state.toolCallCount,
    completed: state.completed
  };
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: describeCause(error.cause)
    };
  }
  return { name: typeof error, message: String(error) };
}

function describeCause(cause: unknown): Record<string, unknown> | string | null {
  if (!cause) {
    return null;
  }
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
      cause: describeCause(cause.cause)
    };
  }
  return typeof cause === 'object' ? safeJsonStringify(cause) : String(cause);
}

function safeJsonStringify(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
