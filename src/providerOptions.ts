import type { ReasoningEffort } from './config.js';

export interface RuntimeModelOptions {
  readonly modelConfiguration?: Record<string, unknown>;
  readonly configuration?: Record<string, unknown>;
  readonly modelOptions?: Record<string, unknown>;
}

export interface ReasoningSelection {
  runtimeOptions: RuntimeModelOptions;
  selectedVariant?: ReasoningEffort;
  agentProfile?: ReasoningEffort;
  globalDefault?: ReasoningEffort;
  modelDefault?: ReasoningEffort;
}

export function resolveReasoningEffort(selection: ReasoningSelection): ReasoningEffort | undefined {
  const reasoningOptions = selection.runtimeOptions.modelOptions?.reasoning;
  return normalizeReasoningEffort(selection.runtimeOptions.modelConfiguration?.reasoningEffort)
    ?? normalizeReasoningEffort(selection.runtimeOptions.configuration?.reasoningEffort)
    ?? normalizeReasoningEffort(selection.runtimeOptions.modelOptions?.reasoningEffort)
    ?? normalizeReasoningEffort(isRecord(reasoningOptions) ? reasoningOptions.effort : undefined)
    ?? selection.selectedVariant
    ?? selection.agentProfile
    ?? selection.globalDefault
    ?? selection.modelDefault;
}

export function clampOutputTokens(configuredLimit: number, modelMaximum: number | undefined): number {
  if (!Number.isFinite(modelMaximum) || (modelMaximum ?? 0) <= 0) {
    return configuredLimit;
  }
  return Math.min(configuredLimit, Math.floor(modelMaximum as number));
}

export function ensureSupportedReasoningEffort(
  effort: ReasoningEffort | undefined,
  capabilities: { model: string; known: boolean; supported: readonly ReasoningEffort[] }
): ReasoningEffort | undefined {
  if (effort && capabilities.known && !capabilities.supported.includes(effort)) {
    const supported = capabilities.supported.length > 0 ? capabilities.supported.join(', ') : 'none';
    throw new RangeError(`Reasoning effort "${effort}" is not supported by effective model "${capabilities.model}". Supported efforts: ${supported}.`);
  }
  return effort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
