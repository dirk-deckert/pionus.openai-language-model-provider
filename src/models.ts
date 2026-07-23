import * as vscode from 'vscode';
import type { ProviderConfig, ReasoningEffort, ServiceTier } from './config.js';
import {
  findModelDefinition,
  findOpenAIModelCatalogEntry,
  type ModelDefinition,
  type OpenAIModelCatalogEntry
} from './modelCatalog.js';
import type { ApiCredentials } from './secrets.js';
import { normalizeBaseURL } from './urlUtils.js';

const PROVIDER_MODEL_ID_PREFIX = 'codex::';
const REASONING_ID_DELIMITER = '::reasoning=';
const TIER_ID_DELIMITER = '::tier=';
const DEFAULT_INPUT_LIMIT = 272_000;

const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
  ultra: 'Ultra'
};

export type ModelDiscoveryTarget = 'chatgpt' | 'openai' | 'custom';

export interface UpstreamModel {
  id?: unknown;
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  context_window?: unknown;
  max_output_tokens?: unknown;
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

export interface ProviderModelMetadata {
  requestModel: string;
  name: string;
  tooltip: string;
  version: string;
  /** Full context window when upstream distinguishes it from the input limit. */
  contextWindowTokens?: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  imageInput: boolean;
  toolCalling: boolean;
  streaming: boolean;
  /** Controls whether explicit Normal and Fast picker entries can be offered. */
  fastTierAvailability: 'advertised' | 'not-advertised' | 'unknown';
  supportedReasoningEfforts: readonly ReasoningEffort[];
  /** Whether the endpoint/catalog authoritatively enumerated the supported efforts. */
  reasoningEffortsKnown: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  source: ModelDiscoveryTarget | 'fallback';
  sourceURL?: string;
  sourceURLs?: readonly string[];
  reviewedAt?: string;
}

export interface ResolvedProviderModel {
  info: vscode.LanguageModelChatInformation;
  requestModel: string;
  reasoningEffort?: ReasoningEffort;
  serviceTier?: ServiceTier;
  metadata: ProviderModelMetadata;
}

export interface ParsedModelIdentifier {
  requestModel: string;
  reasoningEffort?: ReasoningEffort;
  serviceTier?: ServiceTier;
}

type ModelLimitConfig = Pick<ProviderConfig, 'model' | 'maxOutputTokens'>;

export async function fetchAvailableModels(
  config: ProviderConfig,
  credentials: ApiCredentials,
  token: vscode.CancellationToken,
  target: ModelDiscoveryTarget = 'chatgpt'
): Promise<UpstreamModel[]> {
  const modelsURL = new URL(`${normalizeBaseURL(config.baseURL)}/models`);
  if (target === 'chatgpt') {
    modelsURL.searchParams.set('client_version', config.clientVersion);
  }
  const cancellation = bindCancellationToken(token);
  try {
    const response = await fetch(modelsURL, {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        ...credentials.headers
      },
      signal: cancellation.signal
    });

    if (!response.ok) {
      throw new Error(`Model discovery failed with ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as { models?: unknown; data?: unknown };
    const values = Array.isArray(payload.models) ? payload.models : Array.isArray(payload.data) ? payload.data : [];
    return values
      .filter((value): value is UpstreamModel => typeof value === 'object' && value !== null)
      .filter((model) => isModelVisible(model, target));
  } finally {
    cancellation.dispose();
  }
}

/**
 * Converts endpoint-specific discovery results into VS Code picker entries.
 * The default target preserves the pre-0.1 ChatGPT `slug` behavior.
 */
export function buildProviderModels(
  config: ProviderConfig,
  upstreamModels: readonly UpstreamModel[],
  target: ModelDiscoveryTarget = 'chatgpt'
): ResolvedProviderModel[] {
  const metadata = deduplicateMetadata(upstreamModels.flatMap((model) => {
    const resolved = resolveDiscoveredModelMetadata(model, target, config);
    return resolved ? [resolved] : [];
  }));
  if (metadata.length > 0) {
    return metadata.flatMap((model) => buildModelVariants(config, model));
  }

  // A successful OpenAI discovery is a strict account/catalog intersection.
  // Do not advertise catalog models that the account did not return.
  return target === 'openai' ? [] : buildFallbackModels(config, target);
}

export function buildFallbackModels(
  config: ProviderConfig,
  target: ModelDiscoveryTarget = 'chatgpt'
): ResolvedProviderModel[] {
  if (target === 'openai') {
    const metadata = resolveModelMetadata(config.model, target, config);
    return metadata?.streaming ? [buildModel(metadata, config.defaultServiceTier)] : [];
  }

  const definition = findModelDefinition(config.model) ?? config.model;
  return [buildModel(buildFallbackMetadata(config, definition), config.defaultServiceTier)];
}

/**
 * Resolves capabilities for the actual request model (including agent-profile
 * overrides). OpenAI models use only reviewed catalog entries; ChatGPT and
 * custom endpoints fall back conservatively when they did not advertise a
 * matching model.
 */
export function resolveModelMetadata(
  modelId: string,
  target: ModelDiscoveryTarget,
  config: ModelLimitConfig = { model: 'gpt-5.6-sol', maxOutputTokens: 8192 },
  upstreamModels: readonly UpstreamModel[] = []
): ProviderModelMetadata | undefined {
  const requestModel = parseModelIdentifier(modelId).requestModel;
  const upstream = upstreamModels.find((model) => getUpstreamModelId(model, target) === requestModel);
  if (upstream) {
    return resolveDiscoveredModelMetadata(upstream, target, config);
  }

  if (target === 'openai') {
    const entry = findOpenAIModelCatalogEntry(requestModel);
    return entry ? buildOpenAIMetadata(requestModel, entry) : undefined;
  }

  return buildFallbackMetadata(config, findModelDefinition(requestModel) ?? requestModel);
}

export function parseModelIdentifier(modelId: string): ParsedModelIdentifier {
  let normalized = modelId.startsWith(PROVIDER_MODEL_ID_PREFIX) ? modelId.slice(PROVIDER_MODEL_ID_PREFIX.length) : modelId;
  let serviceTier: ServiceTier | undefined;
  const tierIndex = normalized.lastIndexOf(TIER_ID_DELIMITER);
  if (tierIndex >= 0) {
    serviceTier = normalizeServiceTier(normalized.slice(tierIndex + TIER_ID_DELIMITER.length));
    if (serviceTier) {
      normalized = normalized.slice(0, tierIndex);
    }
  }

  const delimiterIndex = normalized.indexOf(REASONING_ID_DELIMITER);
  if (delimiterIndex < 0) {
    return { requestModel: normalized, serviceTier };
  }

  const requestModel = normalized.slice(0, delimiterIndex);
  const reasoningEffort = normalizeReasoningEffort(normalized.slice(delimiterIndex + REASONING_ID_DELIMITER.length));
  return { requestModel, reasoningEffort, serviceTier };
}

function resolveDiscoveredModelMetadata(
  model: UpstreamModel,
  target: ModelDiscoveryTarget,
  config: ModelLimitConfig
): ProviderModelMetadata | undefined {
  const requestModel = getUpstreamModelId(model, target);
  if (!requestModel) {
    return undefined;
  }

  if (target === 'openai') {
    const catalogEntry = findOpenAIModelCatalogEntry(requestModel);
    // GPT-5.5 Pro is cataloged for accurate lookup, but it cannot satisfy the
    // provider's streaming contract and therefore is not offered in the picker.
    return catalogEntry?.streaming ? buildOpenAIMetadata(requestModel, catalogEntry) : undefined;
  }

  const fallbackReasoningEffort = findModelDefinition(requestModel)?.fallback?.defaultReasoningEffort;
  const defaultReasoningEffort = normalizeReasoningEffort(model.default_reasoning_level) ?? fallbackReasoningEffort;
  const reasoningOptions = getReasoningOptions(model, defaultReasoningEffort);
  const maxOutputTokens = getPositiveInteger(model.max_output_tokens) ?? config.maxOutputTokens;
  const advertisedContext = getPositiveInteger(model.context_window);
  const maxInputTokens = advertisedContext ?? DEFAULT_INPUT_LIMIT;
  return {
    requestModel,
    name: getString(model.display_name) ?? formatDisplayName(requestModel),
    tooltip: getString(model.description) ?? (target === 'chatgpt'
      ? 'Codex model discovered from the ChatGPT Codex backend.'
      : 'Model discovered from the configured Responses-compatible endpoint.'),
    version: getString(model.comp_hash) ?? '1.0.0',
    contextWindowTokens: advertisedContext,
    maxInputTokens,
    maxOutputTokens,
    imageInput: Array.isArray(model.input_modalities) && model.input_modalities.includes('image'),
    toolCalling: true,
    streaming: true,
    fastTierAvailability: getFastTierAvailability(model),
    supportedReasoningEfforts: reasoningOptions.map((option) => option.effort),
    reasoningEffortsKnown: Array.isArray(model.supported_reasoning_levels),
    defaultReasoningEffort,
    source: target
  };
}

function buildOpenAIMetadata(requestModel: string, entry: OpenAIModelCatalogEntry): ProviderModelMetadata {
  return {
    requestModel,
    name: entry.name,
    tooltip: `${entry.description} OpenAI metadata reviewed ${entry.reviewedAt}.`,
    version: entry.reviewedAt,
    contextWindowTokens: entry.contextWindowTokens,
    maxInputTokens: Math.max(1, entry.contextWindowTokens - entry.maxOutputTokens),
    maxOutputTokens: entry.maxOutputTokens,
    imageInput: entry.imageInput,
    toolCalling: entry.toolCalling,
    streaming: entry.streaming,
    fastTierAvailability: 'unknown',
    supportedReasoningEfforts: entry.supportedReasoningEfforts,
    reasoningEffortsKnown: true,
    defaultReasoningEffort: entry.defaultReasoningEffort,
    source: 'openai',
    sourceURL: entry.sourceURL,
    sourceURLs: entry.sourceURLs,
    reviewedAt: entry.reviewedAt
  };
}

function buildFallbackMetadata(
  config: ModelLimitConfig,
  model: ModelDefinition | string
): ProviderModelMetadata {
  const requestModel = typeof model === 'string' ? model : model.id;
  const fallback = typeof model === 'string' ? undefined : model.fallback;
  const defaultReasoningEffort = fallback?.defaultReasoningEffort;
  return {
    requestModel,
    name: formatDisplayName(requestModel),
    tooltip: 'Conservative fallback model used when discovery metadata is unavailable.',
    version: '1.0.0',
    maxInputTokens: fallback?.maxInputTokens ?? DEFAULT_INPUT_LIMIT,
    maxOutputTokens: config.maxOutputTokens,
    imageInput: fallback?.imageInput ?? false,
    toolCalling: true,
    streaming: true,
    fastTierAvailability: 'unknown',
    supportedReasoningEfforts: defaultReasoningEffort ? [defaultReasoningEffort] : [],
    reasoningEffortsKnown: false,
    defaultReasoningEffort,
    source: 'fallback'
  };
}

function buildModelVariants(config: ProviderConfig, metadata: ProviderModelMetadata): ResolvedProviderModel[] {
  if (metadata.fastTierAvailability === 'advertised') {
    return [buildModel(metadata, 'default'), buildModel(metadata, 'fast')];
  }
  if (metadata.fastTierAvailability === 'not-advertised') {
    return [buildModel(metadata, 'default')];
  }
  return [buildModel(metadata, config.defaultServiceTier)];
}

function buildModel(metadata: ProviderModelMetadata, serviceTier?: ServiceTier): ResolvedProviderModel {
  const reasoningOptions = deduplicateReasoning(metadata.supportedReasoningEfforts).map(toReasoningOption);
  const configurationSchema = buildModelConfigurationSchema(
    reasoningOptions,
    metadata.defaultReasoningEffort ?? reasoningOptions[0]?.effort
  );
  const tierLabel = serviceTier === 'fast' ? 'Fast' : serviceTier === 'default' ? 'Normal' : 'Auto';
  const tierSuffix = serviceTier ? `${TIER_ID_DELIMITER}${serviceTier}` : '';
  const info = {
    id: `${PROVIDER_MODEL_ID_PREFIX}${metadata.requestModel}${tierSuffix}`,
    name: `${metadata.name} (${tierLabel})`,
    family: metadata.requestModel,
    version: metadata.version,
    maxInputTokens: metadata.maxInputTokens,
    maxOutputTokens: metadata.maxOutputTokens,
    tooltip: metadata.tooltip,
    detail: buildModelDetail(metadata, reasoningOptions, tierLabel),
    capabilities: {
      imageInput: metadata.imageInput,
      toolCalling: metadata.toolCalling
    },
    ...(configurationSchema ? { configurationSchema } : {})
  } as vscode.LanguageModelChatInformation;
  return {
    info,
    requestModel: metadata.requestModel,
    reasoningEffort: metadata.defaultReasoningEffort,
    serviceTier,
    metadata
  };
}

function buildModelConfigurationSchema(
  reasoningOptions: ReasoningOption[],
  defaultEffort: ReasoningEffort | undefined
) {
  const properties = {
    ...(reasoningOptions.length > 1 ? {
      reasoningEffort: {
        type: 'string',
        title: 'Thinking Effort',
        enum: reasoningOptions.map((option) => option.effort),
        enumItemLabels: reasoningOptions.map((option) => REASONING_LABELS[option.effort]),
        enumDescriptions: reasoningOptions.map((option) => option.description),
        default: defaultEffort ?? reasoningOptions[0]?.effort,
        group: 'navigation'
      }
    } : {})
  };

  if (Object.keys(properties).length === 0) {
    return undefined;
  }
  return {
    properties
  };
}

function getReasoningOptions(model: UpstreamModel, defaultReasoningEffort: ReasoningEffort | undefined): ReasoningOption[] {
  const options: ReasoningOption[] = [];
  if (defaultReasoningEffort) {
    options.push(toReasoningOption(defaultReasoningEffort));
  }

  if (Array.isArray(model.supported_reasoning_levels)) {
    for (const level of model.supported_reasoning_levels) {
      const effort = normalizeReasoningEffort(typeof level === 'string' ? level : (level as { effort?: unknown } | null)?.effort);
      if (!effort) {
        continue;
      }
      const existingIndex = options.findIndex((option) => option.effort === effort);
      const option = {
        effort,
        description: typeof level === 'object' && level !== null
          ? getString((level as { description?: unknown }).description) ?? getReasoningDescription(effort)
          : getReasoningDescription(effort)
      };
      if (existingIndex >= 0) {
        options[existingIndex] = option;
      } else {
        options.push(option);
      }
    }
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
    case 'max': return 'Maximum reasoning depth for the hardest problems.';
    case 'ultra': return 'Maximum reasoning with automatic task delegation.';
  }
}

function buildModelDetail(
  metadata: ProviderModelMetadata,
  reasoningOptions: ReasoningOption[],
  tierLabel: 'Normal' | 'Fast' | 'Auto'
): string {
  const parts = [metadata.contextWindowTokens
    ? `Context: ${metadata.contextWindowTokens.toLocaleString()} tokens`
    : `Input limit: ${metadata.maxInputTokens.toLocaleString()} tokens`];
  parts.push(`Max output: ${metadata.maxOutputTokens.toLocaleString()} tokens`);
  if (reasoningOptions.length > 0) {
    const labels = reasoningOptions.map((option) => REASONING_LABELS[option.effort]).join(', ');
    const selected = metadata.defaultReasoningEffort;
    parts.push(selected ? `Thinking: ${labels} (default: ${REASONING_LABELS[selected]})` : `Thinking: ${labels}`);
  }
  parts.push(`Service tier: ${tierLabel}`);
  return parts.join(' | ');
}

function getUpstreamModelId(model: UpstreamModel, target: ModelDiscoveryTarget): string | undefined {
  if (target === 'chatgpt') {
    return getString(model.slug);
  }
  if (target === 'openai') {
    return getString(model.id);
  }
  return getString(model.id) ?? getString(model.slug);
}

function getFastTierAvailability(model: UpstreamModel): ProviderModelMetadata['fastTierAvailability'] {
  const tierLists = [model.service_tiers, model.supported_service_tiers].filter(Array.isArray);
  if (tierLists.some((tiers) => tiers.some(isFastTierValue))) {
    return 'advertised';
  }

  const requirements = typeof model.feature_requirements === 'object' && model.feature_requirements !== null
    ? model.feature_requirements as Record<string, unknown>
    : undefined;
  if (requirements?.fast === true || requirements?.priority === true) {
    return 'advertised';
  }
  if (tierLists.length > 0 || requirements?.fast === false || requirements?.priority === false) {
    return 'not-advertised';
  }
  return 'unknown';
}

function isFastTierValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'fast' || value.toLowerCase() === 'priority';
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return [record.id, record.name, record.slug, record.tier, record.service_tier].some(isFastTierValue);
}

function deduplicateMetadata(models: readonly ProviderModelMetadata[]): ProviderModelMetadata[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.requestModel)) {
      return false;
    }
    seen.add(model.requestModel);
    return true;
  });
}

function deduplicateReasoning(values: readonly ReasoningEffort[]): ReasoningEffort[] {
  return [...new Set(values)];
}

function formatDisplayName(model: string): string {
  return model.trim().split('-').map((part) => {
    if (/^gpt$/i.test(part)) {
      return 'GPT';
    }
    if (/^codex$/i.test(part)) {
      return 'Codex';
    }
    return part ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
  }).join('-');
}

function isModelVisible(model: UpstreamModel, target: ModelDiscoveryTarget): boolean {
  if (target === 'openai' && model.supported_in_api === false) {
    return false;
  }
  if (target === 'chatgpt' && getString(model.slug)?.toLowerCase() === 'codex-auto-review') {
    return true;
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
    case 'max':
    case 'ultra':
      return value;
    default:
      return undefined;
  }
}

function normalizeServiceTier(value: unknown): ServiceTier | undefined {
  return value === 'default' || value === 'fast' ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function bindCancellationToken(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
  if (token.isCancellationRequested) {
    const controller = new AbortController();
    controller.abort();
    return { signal: controller.signal, dispose: () => undefined };
  }
  const controller = new AbortController();
  const cancellation = token.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => cancellation.dispose() };
}
