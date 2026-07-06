import type { ResponseUsage } from 'openai/resources/responses/responses';
import * as vscode from 'vscode';
import { convertMessagesToResponsesInput, estimateTokenCount } from './convertMessages.js';
import { getConfigurationSection, getProviderConfig, normalizeReasoningEffort, type ProviderConfig, type ReasoningEffort } from './config.js';
import { buildFallbackModel, buildProviderModels, fetchAvailableModels, parseModelIdentifier, type ResolvedProviderModel } from './models.js';
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

export class CodexModelProvider implements vscode.LanguageModelChatProvider {
  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void>;
  private readonly modelInfoChangedEmitter = new vscode.EventEmitter<void>();
  private cachedModels?: { key: string; expiresAt: number; models: ResolvedProviderModel[] };
  private lastResponseId?: string;

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
    const input = convertMessagesToResponsesInput(messages, Boolean(model.capabilities?.imageInput) && config.enableImageInput);
    const requestStartedAt = Date.now();

    this.outputChannel.info('provideLanguageModelChatResponse start', {
      modelId: model.id,
      requestModel: parsedModel.requestModel,
      serviceTier: parsedModel.serviceTier ?? 'normal',
      reasoningEffort: reasoningEffort ?? null,
      agentProfile: agentProfile?.id ?? null,
      toolCount: options.tools?.length ?? 0,
      credentialSource: credentials.source
    });

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
      previousResponseId: config.enablePreviousResponseId ? this.lastResponseId : undefined,
      token,
      onTextDelta: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
      onReasoningTextDelta: (text) => {
        const thinkingPart = createThinkingPart(text);
        if (thinkingPart) {
          progress.report(thinkingPart);
        }
      },
      onToolCall: (callId, name, input) => progress.report(new vscode.LanguageModelToolCallPart(callId, name, input)),
      onResponseCreated: (response) => {
        if (response.id) {
          this.lastResponseId = response.id;
        }
      },
      onResponseCompleted: (response) => {
        this.outputChannel.info('response completed', {
          requestModel: parsedModel.requestModel,
          responseId: response.id,
          durationMs: Date.now() - requestStartedAt,
          usage: response.usage ?? null
        });
        if (response.id) {
          this.lastResponseId = response.id;
        }
        const usagePart = createUsageDataPart(response.usage);
        if (usagePart) {
          progress.report(usagePart);
        }
        if (response.usage) {
          this.usageSink?.record({ model: parsedModel.requestModel, usage: response.usage, completedAt: Date.now() });
        }
      },
      onResponseFailed: (message) => this.outputChannel.error(`response failed model=${parsedModel.requestModel} message=${message}`)
    });
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
      models = [buildFallbackModel(config)];
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
  if (serviceTier === 'fast') {
    return 'priority';
  }
  return undefined;
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