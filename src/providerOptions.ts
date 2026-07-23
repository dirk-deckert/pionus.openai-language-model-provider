import type { ReasoningEffort, ServiceTier } from './config.js';

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

export interface ServiceTierSelection {
  runtimeOptions: RuntimeModelOptions;
  selectedVariant?: ServiceTier;
  globalDefault?: ServiceTier;
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

export function resolveServiceTier(selection: ServiceTierSelection): ServiceTier | undefined {
  // An encoded picker entry must be authoritative so its visible Normal/Fast
  // label always matches the request sent to the backend.
  if (selection.selectedVariant) {
    return selection.selectedVariant;
  }
  const runtimeTier = normalizeServiceTier(selection.runtimeOptions.modelConfiguration?.serviceTier)
    ?? normalizeServiceTier(selection.runtimeOptions.configuration?.serviceTier)
    ?? normalizeServiceTier(selection.runtimeOptions.modelOptions?.serviceTier);
  if (runtimeTier === 'normal') {
    return 'default';
  }
  return runtimeTier ?? selection.globalDefault;
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

function normalizeServiceTier(value: unknown): 'normal' | 'fast' | undefined {
  return value === 'normal' || value === 'fast' ? value : undefined;
}
