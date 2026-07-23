import type { ReasoningEffort } from './config.js';

export const OPENAI_MODEL_CATALOG_REVIEWED_AT = '2026-07-19';
export const OPENAI_MODEL_GUIDANCE_URL = 'https://developers.openai.com/api/docs/guides/latest-model';

export interface OpenAIModelCatalogEntry {
  /** Canonical API model identifier. */
  id: string;
  /** Explicitly documented aliases and snapshots that share these capabilities. */
  aliases: readonly string[];
  name: string;
  description: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  imageInput: boolean;
  toolCalling: boolean;
  streaming: boolean;
  supportedReasoningEfforts: readonly ReasoningEffort[];
  /** Omitted when the cited API documentation does not state a default. */
  defaultReasoningEffort?: ReasoningEffort;
  sourceURL: string;
  sourceURLs: readonly string[];
  reviewedAt: string;
}

export interface ModelFallbackDefinition {
  /** Compatibility picker order. Omitted for discovery-only models. */
  pickerOrder?: number;
  maxInputTokens?: number;
  imageInput?: boolean;
  defaultReasoningEffort?: ReasoningEffort;
}

export type ModelDefinition = (OpenAIModelCatalogEntry & {
  openAI: true;
  fallback?: ModelFallbackDefinition;
}) | {
  id: string;
  aliases: readonly string[];
  openAI: false;
  fallback: ModelFallbackDefinition;
};

/**
 * Unified model registry. `openAI: true` entries contain reviewed metadata for
 * current GPT-5.6, GPT-5.5, and GPT-5.4 Responses models. Sparse fallback data
 * preserves established ChatGPT picker and reasoning behavior when discovery
 * is unavailable. Callers must not infer capabilities from similar names.
 */
export const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  {
    openAI: true,
    id: 'gpt-5.6-sol',
    aliases: ['gpt-5.6'],
    name: 'GPT-5.6 Sol',
    description: 'Frontier model for complex professional work.',
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.6-sol', OPENAI_MODEL_GUIDANCE_URL],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT,
    fallback: { pickerOrder: 0, maxInputTokens: 272_000, imageInput: true, defaultReasoningEffort: 'low' }
  },
  {
    openAI: true,
    id: 'gpt-5.6-terra',
    aliases: [],
    name: 'GPT-5.6 Terra',
    description: 'GPT-5.6 model that balances intelligence and cost.',
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.6-terra', OPENAI_MODEL_GUIDANCE_URL],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT,
    fallback: { pickerOrder: 1, maxInputTokens: 272_000, imageInput: true, defaultReasoningEffort: 'medium' }
  },
  {
    openAI: true,
    id: 'gpt-5.6-luna',
    aliases: [],
    name: 'GPT-5.6 Luna',
    description: 'GPT-5.6 model optimized for cost-sensitive workloads.',
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.6-luna', OPENAI_MODEL_GUIDANCE_URL],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT,
    fallback: { pickerOrder: 2, maxInputTokens: 272_000, imageInput: true, defaultReasoningEffort: 'medium' }
  },
  {
    openAI: true,
    id: 'gpt-5.5',
    aliases: ['gpt-5.5-2026-04-23'],
    name: 'GPT-5.5',
    description: 'Frontier model for complex coding and professional work.',
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.5',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.5'],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT,
    fallback: { pickerOrder: 3, maxInputTokens: 272_000, imageInput: true, defaultReasoningEffort: 'medium' }
  },
  {
    openAI: true,
    id: 'gpt-5.5-pro',
    aliases: ['gpt-5.5-pro-2026-04-23'],
    name: 'GPT-5.5 Pro',
    description: 'Higher-compute GPT-5.5 model for difficult problems.',
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: false,
    supportedReasoningEfforts: ['medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.5-pro',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.5-pro'],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT
  },
  {
    openAI: true,
    id: 'gpt-5.4',
    aliases: ['gpt-5.4-2026-03-05'],
    name: 'GPT-5.4',
    description: 'Model for coding and complex professional work.',
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'none',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.4',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.4'],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT,
    fallback: { pickerOrder: 4, maxInputTokens: 272_000, imageInput: true, defaultReasoningEffort: 'medium' }
  },
  {
    openAI: true,
    id: 'gpt-5.4-pro',
    aliases: ['gpt-5.4-pro-2026-03-05'],
    name: 'GPT-5.4 Pro',
    description: 'Higher-compute GPT-5.4 model for difficult problems.',
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: true,
    supportedReasoningEfforts: ['medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.4-pro',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.4-pro'],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT
  },
  {
    openAI: true,
    id: 'gpt-5.4-mini',
    aliases: ['gpt-5.4-mini-2026-03-17'],
    name: 'GPT-5.4 Mini',
    description: 'Efficient model for coding, computer use, and subagents.',
    contextWindowTokens: 400_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'none',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.4-mini'],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT,
    fallback: { pickerOrder: 5, maxInputTokens: 272_000, imageInput: true, defaultReasoningEffort: 'medium' }
  },
  {
    openAI: true,
    id: 'gpt-5.4-nano',
    aliases: ['gpt-5.4-nano-2026-03-17'],
    name: 'GPT-5.4 Nano',
    description: 'Low-cost GPT-5.4 model for simple high-volume tasks.',
    contextWindowTokens: 400_000,
    maxOutputTokens: 128_000,
    imageInput: true,
    toolCalling: true,
    streaming: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'none',
    sourceURL: 'https://developers.openai.com/api/docs/models/gpt-5.4-nano',
    sourceURLs: ['https://developers.openai.com/api/docs/models/gpt-5.4-nano'],
    reviewedAt: OPENAI_MODEL_CATALOG_REVIEWED_AT
  },
  {
    id: 'gpt-5.3-codex-spark',
    aliases: ['gpt-5.3-codex-spark-preview'],
    openAI: false,
    fallback: { defaultReasoningEffort: 'high' }
  },
  {
    id: 'codex-auto-review',
    aliases: [],
    openAI: false,
    fallback: { defaultReasoningEffort: 'medium' }
  }
];

export const OPENAI_MODEL_CATALOG: readonly OpenAIModelCatalogEntry[] = MODEL_DEFINITIONS
  .filter((definition): definition is Extract<ModelDefinition, { openAI: true }> => definition.openAI)
  .map(({ openAI: _openAI, fallback: _fallback, ...entry }) => entry);

export function findModelDefinition(modelId: string): ModelDefinition | undefined {
  const normalized = modelId.trim();
  return MODEL_DEFINITIONS.find((definition) => definition.id === normalized);
}

export function getCompatibilityFallbackDefinitions(): readonly ModelDefinition[] {
  return MODEL_DEFINITIONS
    .filter((definition) => definition.fallback?.pickerOrder !== undefined)
    .sort((left, right) => (left.fallback?.pickerOrder ?? 0) - (right.fallback?.pickerOrder ?? 0));
}

export function findOpenAIModelCatalogEntry(modelId: string): OpenAIModelCatalogEntry | undefined {
  const normalized = modelId.trim();
  return OPENAI_MODEL_CATALOG.find((entry) => entry.id === normalized || entry.aliases.includes(normalized));
}
