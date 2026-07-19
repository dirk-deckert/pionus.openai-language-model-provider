export interface UsageTokenCounts {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  input_tokens_details?: {
    cached_tokens?: number | null;
  } | null;
}

export interface ModelPricingUsdPerMTok {
  input: number;
  cachedInput?: number;
  output: number;
}

export interface ValidatedModelPricingUsdPerMTok extends ModelPricingUsdPerMTok {
  cachedInput: number;
}

export type PricingTableUsdPerMTok = Readonly<Record<string, ValidatedModelPricingUsdPerMTok>>;

export interface PricingDiagnostic {
  model?: string;
  message: string;
}

export interface PricingValidationResult {
  pricing: PricingTableUsdPerMTok;
  diagnostics: readonly PricingDiagnostic[];
}

export interface UsageBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageCostUsd {
  uncachedInput: number;
  cachedInput: number;
  output: number;
  total: number;
}

const TOKENS_PER_MILLION = 1_000_000;

export function validateModelPricingUsdPerMTok(value: unknown): PricingValidationResult {
  const pricing: Record<string, ValidatedModelPricingUsdPerMTok> = Object.create(null) as Record<string, ValidatedModelPricingUsdPerMTok>;
  const diagnostics: PricingDiagnostic[] = [];

  if (!isRecord(value)) {
    return {
      pricing,
      diagnostics: [{ message: 'Pricing configuration must be an object keyed by model ID; ignoring it.' }]
    };
  }

  for (const [model, candidate] of Object.entries(value)) {
    if (!model.trim() || model !== model.trim()) {
      diagnostics.push({ model, message: 'Model ID must be non-empty and must not have surrounding whitespace; ignoring this entry.' });
      continue;
    }
    if (!isRecord(candidate)) {
      diagnostics.push({ model, message: 'Pricing entry must be an object; ignoring this entry.' });
      continue;
    }
    const unsupportedFields = Object.keys(candidate).filter((field) => !['input', 'cachedInput', 'output'].includes(field));
    if (unsupportedFields.length > 0) {
      diagnostics.push({
        model,
        message: `Unsupported pricing fields ${unsupportedFields.join(', ')}; ignoring this entry.`
      });
      continue;
    }

    const input = readRate(candidate.input);
    const output = readRate(candidate.output);
    const cachedInput = candidate.cachedInput === undefined ? input : readRate(candidate.cachedInput);
    const invalidFields = [
      input === undefined ? 'input' : undefined,
      cachedInput === undefined ? 'cachedInput' : undefined,
      output === undefined ? 'output' : undefined
    ].filter((field): field is string => field !== undefined);

    if (input === undefined || cachedInput === undefined || output === undefined) {
      diagnostics.push({
        model,
        message: `Pricing fields ${invalidFields.join(', ')} must be finite, non-negative numbers; ignoring this entry.`
      });
      continue;
    }

    pricing[model] = { input, cachedInput, output };
  }

  return { pricing, diagnostics };
}

export function getUsageBreakdown(usage: UsageTokenCounts): UsageBreakdown {
  const inputTokens = normalizeTokenCount(usage.input_tokens);
  const outputTokens = normalizeTokenCount(usage.output_tokens);
  const cachedInputTokens = Math.min(inputTokens, normalizeTokenCount(usage.input_tokens_details?.cached_tokens));
  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: inputTokens - cachedInputTokens,
    outputTokens,
    totalTokens: normalizeTokenCount(usage.total_tokens, inputTokens + outputTokens)
  };
}

export function calculateUsageCostUsd(
  model: string,
  usage: UsageTokenCounts,
  pricing: PricingTableUsdPerMTok
): UsageCostUsd | undefined {
  const rates = pricing[model];
  if (!rates) {
    return undefined;
  }

  const tokens = getUsageBreakdown(usage);
  const uncachedInput = tokens.uncachedInputTokens * rates.input / TOKENS_PER_MILLION;
  const cachedInput = tokens.cachedInputTokens * rates.cachedInput / TOKENS_PER_MILLION;
  const output = tokens.outputTokens * rates.output / TOKENS_PER_MILLION;
  return {
    uncachedInput,
    cachedInput,
    output,
    total: uncachedInput + cachedInput + output
  };
}

export function formatUsageTokens(usage: UsageTokenCounts): string {
  const tokens = getUsageBreakdown(usage);
  return `input ${tokens.inputTokens}, output ${tokens.outputTokens}, total ${tokens.totalTokens}`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('USD value must be finite and non-negative.');
  }
  if (value === 0) {
    return '$0.00';
  }
  if (value < 0.000001) {
    return '<$0.000001';
  }
  if (value < 0.01) {
    return `$${value.toFixed(6)}`;
  }
  if (value < 1) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

function normalizeTokenCount(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function readRate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
