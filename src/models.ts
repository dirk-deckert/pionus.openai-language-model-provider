import * as vscode from 'vscode';
import type { ProviderConfig, ReasoningEffort } from './config.js';
import type { ApiCredentials } from './secrets.js';
import { normalizeBaseURL } from './urlUtils.js';

const PROVIDER_MODEL_ID_PREFIX = 'codex::';
const REASONING_ID_DELIMITER = '::reasoning=';
const FAST_ID_SUFFIX = '::tier=fast';
const DEFAULT_CONTEXT_WINDOW = 272000;

const MODEL_DEFAULT_REASONING: Partial<Record<string, ReasoningEffort>> = {
  'gpt-5.5': 'xhigh',
  'gpt-5.4': 'medium',
  'gpt-5.4-mini': 'medium',
  'gpt-5.3-codex-spark-preview': 'high',
  'codex-auto-review': 'medium'
};

const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High'
};

interface UpstreamModel {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  context_window?: unknown;
  input_modalities?: unknown;
  comp_hash?: unknown;
  supported_in_api?: unknown;
  visibility?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
  service_tiers?: unknown;
  supported_service_tiers?: unknown;
  feature_requirements?: unknown;
}

interface ReasoningOption {
  effort: ReasoningEffort;
  description: string;
}

export interface ResolvedProviderModel {
  info: vscode.LanguageModelChatInformation;
  requestModel: string;
  reasoningEffort?: ReasoningEffort;
  serviceTier?: 'fast';
}

export interface ParsedModelIdentifier {
  requestModel: string;
  reasoningEffort?: ReasoningEffort;
  serviceTier?: 'fast';
}

export async function fetchAvailableModels(
  config: ProviderConfig,
  credentials: ApiCredentials,
  token: vscode.CancellationToken
): Promise<UpstreamModel[]> {
  const modelsURL = new URL(`${normalizeBaseURL(config.baseURL)}/models`);
  modelsURL.searchParams.set('client_version', config.clientVersion);
  const response = await fetch(modelsURL, {
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      ...credentials.headers
    },
    signal: toAbortSignal(token)
  });

  if (!response.ok) {
    throw new Error(`Model discovery failed with ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { models?: unknown; data?: unknown };
  const values = Array.isArray(payload.models) ? payload.models : Array.isArray(payload.data) ? payload.data : [];
  return values.filter((value): value is UpstreamModel => typeof value === 'object' && value !== null).filter(isModelVisible);
}

export function buildProviderModels(config: ProviderConfig, upstreamModels: UpstreamModel[]): ResolvedProviderModel[] {
  const models = upstreamModels.flatMap((model) => buildDiscoveredModel(model, config));
  if (models.length > 0) {
    return models;
  }

  const fallbackModel = buildFallbackModel(config);
  return [fallbackModel, createFastVariant(fallbackModel)];
}

export function buildFallbackModel(config: ProviderConfig): ResolvedProviderModel {
  const reasoningEffort = MODEL_DEFAULT_REASONING[config.model];
  return buildModel({
    config,
    requestModel: config.model,
    name: formatDisplayName(config.model),
    tooltip: 'Codex fallback model used when discovery is unavailable.',
    maxInputTokens: DEFAULT_CONTEXT_WINDOW,
    version: '1.0.0',
    imageInput: false,
    reasoningOptions: reasoningEffort ? [toReasoningOption(reasoningEffort)] : [],
    defaultReasoningEffort: reasoningEffort,
    serviceTier: undefined
  });
}

export function parseModelIdentifier(modelId: string): ParsedModelIdentifier {
  let normalized = modelId.startsWith(PROVIDER_MODEL_ID_PREFIX) ? modelId.slice(PROVIDER_MODEL_ID_PREFIX.length) : modelId;
  let serviceTier: 'fast' | undefined;
  if (normalized.endsWith(FAST_ID_SUFFIX)) {
    serviceTier = 'fast';
    normalized = normalized.slice(0, -FAST_ID_SUFFIX.length);
  }

  const delimiterIndex = normalized.indexOf(REASONING_ID_DELIMITER);
  if (delimiterIndex < 0) {
    return { requestModel: normalized, serviceTier };
  }

  const requestModel = normalized.slice(0, delimiterIndex);
  const reasoningEffort = normalizeReasoningEffort(normalized.slice(delimiterIndex + REASONING_ID_DELIMITER.length));
  return { requestModel, reasoningEffort, serviceTier };
}

function buildDiscoveredModel(model: UpstreamModel, config: ProviderConfig): ResolvedProviderModel[] {
  const requestModel = getString(model.slug) ?? config.model;
  const defaultReasoningEffort = normalizeReasoningEffort(model.default_reasoning_level) ?? MODEL_DEFAULT_REASONING[requestModel];
  const reasoningOptions = getReasoningOptions(model, requestModel, defaultReasoningEffort);
  const baseModel = buildModel({
    config,
    requestModel,
    name: getString(model.display_name) ?? formatDisplayName(requestModel),
    tooltip: getString(model.description) ?? 'Codex model discovered from the ChatGPT Codex backend.',
    maxInputTokens: getPositiveInteger(model.context_window) ?? DEFAULT_CONTEXT_WINDOW,
    version: getString(model.comp_hash) ?? '1.0.0',
    imageInput: Array.isArray(model.input_modalities) && model.input_modalities.includes('image'),
    reasoningOptions,
    defaultReasoningEffort,
    serviceTier: undefined
  });

  return supportsFastTier(model) ? [baseModel, createFastVariant(baseModel)] : [baseModel];
}

function createFastVariant(model: ResolvedProviderModel): ResolvedProviderModel {
  const fastId = `${PROVIDER_MODEL_ID_PREFIX}${model.requestModel}${FAST_ID_SUFFIX}`;
  return {
    ...model,
    serviceTier: 'fast',
    info: {
      ...model.info,
      id: fastId,
      name: `${model.info.name} Fast`,
      version: `${model.info.version}-fast`,
      tooltip: `${model.info.tooltip ?? ''} Fast service tier.`.trim(),
      detail: appendDetail(model.info.detail, 'Fast tier')
    } as vscode.LanguageModelChatInformation
  };
}

function appendDetail(detail: string | undefined, value: string): string {
  return detail?.trim() ? `${detail} | ${value}` : value;
}

function buildModel(options: {
  config: ProviderConfig;
  requestModel: string;
  name: string;
  tooltip: string;
  maxInputTokens: number;
  version: string;
  imageInput: boolean;
  reasoningOptions: ReasoningOption[];
  defaultReasoningEffort?: ReasoningEffort;
  serviceTier?: 'fast';
}): ResolvedProviderModel {
  const configurationSchema = options.reasoningOptions.length > 1
    ? buildThinkingEffortSchema(options.reasoningOptions, options.defaultReasoningEffort ?? options.reasoningOptions[0]?.effort)
    : undefined;
  const id = `${PROVIDER_MODEL_ID_PREFIX}${options.requestModel}${options.serviceTier === 'fast' ? FAST_ID_SUFFIX : ''}`;
  const info = {
    id,
    name: options.name,
    family: options.requestModel,
    version: options.version,
    maxInputTokens: options.maxInputTokens,
    maxOutputTokens: options.config.maxOutputTokens,
    tooltip: options.tooltip,
    detail: buildModelDetail(options.maxInputTokens, options.reasoningOptions, options.defaultReasoningEffort, options.serviceTier),
    capabilities: {
      imageInput: options.imageInput,
      toolCalling: true
    },
    ...(configurationSchema ? { configurationSchema } : {})
  } as vscode.LanguageModelChatInformation;
  return {
    info,
    requestModel: options.requestModel,
    reasoningEffort: options.defaultReasoningEffort,
    serviceTier: options.serviceTier
  };
}

function buildThinkingEffortSchema(reasoningOptions: ReasoningOption[], defaultEffort: ReasoningEffort | undefined) {
  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: 'Thinking Effort',
        enum: reasoningOptions.map((option) => option.effort),
        enumItemLabels: reasoningOptions.map((option) => REASONING_LABELS[option.effort]),
        enumDescriptions: reasoningOptions.map((option) => option.description),
        default: defaultEffort ?? reasoningOptions[0]?.effort,
        group: 'navigation'
      }
    }
  };
}

function getReasoningOptions(model: UpstreamModel, slug: string, defaultReasoningEffort: ReasoningEffort | undefined): ReasoningOption[] {
  const options: ReasoningOption[] = [];
  if (defaultReasoningEffort) {
    options.push(toReasoningOption(defaultReasoningEffort));
  }

  if (Array.isArray(model.supported_reasoning_levels)) {
    for (const level of model.supported_reasoning_levels) {
      if (typeof level !== 'object' || level === null) {
        continue;
      }
      const effort = normalizeReasoningEffort((level as { effort?: unknown }).effort);
      if (!effort) {
        continue;
      }
      const existingIndex = options.findIndex((option) => option.effort === effort);
      const option = {
        effort,
        description: getString((level as { description?: unknown }).description) ?? getReasoningDescription(effort)
      };
      if (existingIndex >= 0) {
        options[existingIndex] = option;
      } else {
        options.push(option);
      }
    }
  }

  if (options.length === 0 && MODEL_DEFAULT_REASONING[slug]) {
    options.push(toReasoningOption(MODEL_DEFAULT_REASONING[slug]));
  }
  return options;
}

function toReasoningOption(effort: ReasoningEffort): ReasoningOption {
  return { effort, description: getReasoningDescription(effort) };
}

function getReasoningDescription(effort: ReasoningEffort): string {
  switch (effort) {
    case 'none': return 'Skip extra reasoning when supported.';
    case 'minimal': return 'Use a very light reasoning pass.';
    case 'low': return 'Fast responses with lighter reasoning.';
    case 'medium': return 'Balanced reasoning for everyday tasks.';
    case 'high': return 'Greater reasoning depth for complex problems.';
    case 'xhigh': return 'Extra high reasoning depth for complex problems.';
  }
}

function supportsFastTier(model: UpstreamModel): boolean {
  const candidates = [model.service_tiers, model.supported_service_tiers, model.feature_requirements];
  return candidates.some((candidate) => JSON.stringify(candidate ?? '').toLowerCase().includes('fast'));
}

function buildModelDetail(maxInputTokens: number, reasoningOptions: ReasoningOption[], defaultEffort: ReasoningEffort | undefined, serviceTier: 'fast' | undefined): string {
  const parts = [`Context: ${maxInputTokens.toLocaleString()} tokens`];
  if (reasoningOptions.length > 0) {
    const labels = reasoningOptions.map((option) => REASONING_LABELS[option.effort]).join(', ');
    parts.push(defaultEffort ? `Thinking: ${labels} (default: ${REASONING_LABELS[defaultEffort]})` : `Thinking: ${labels}`);
  }
  if (serviceTier === 'fast') {
    parts.push('Fast tier');
  }
  return parts.join(' | ');
}

function formatDisplayName(model: string): string {
  return model.trim().replace(/^gpt/i, 'GPT').replace(/codex/gi, 'Codex');
}

function isModelVisible(model: UpstreamModel): boolean {
  if (model.supported_in_api === false) {
    return false;
  }
  const visibility = getString(model.visibility)?.toLowerCase();
  return visibility !== 'hidden' && visibility !== 'hide';
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  switch (value) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value;
    default:
      return undefined;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
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