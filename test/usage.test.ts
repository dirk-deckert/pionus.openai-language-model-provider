import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateUsageCostUsd,
  formatUsageTokens,
  formatUsd,
  getUsageBreakdown,
  validateModelPricingUsdPerMTok
} from '../src/usage.js';

test('validates pricing and defaults cached input to the input rate', () => {
  const result = validateModelPricingUsdPerMTok({
    'gpt-5.6-sol': { input: 5, output: 30 },
    'gpt-5.5': { input: 4, cachedInput: 0.4, output: 20 }
  });

  assert.deepEqual({ ...result.pricing }, {
    'gpt-5.6-sol': { input: 5, cachedInput: 5, output: 30 },
    'gpt-5.5': { input: 4, cachedInput: 0.4, output: 20 }
  });
  assert.deepEqual(result.diagnostics, []);
});

test('ignores invalid pricing entries and returns actionable diagnostics', () => {
  const result = validateModelPricingUsdPerMTok({
    valid: { input: 0, cachedInput: 0, output: 0 },
    missingOutput: { input: 5 },
    negative: { input: -1, output: 30 },
    nan: { input: 5, output: Number.NaN },
    object: 'not an object',
    extra: { input: 5, output: 30, request: 1 },
    ' spaced ': { input: 5, output: 30 }
  });

  assert.deepEqual({ ...result.pricing }, {
    valid: { input: 0, cachedInput: 0, output: 0 }
  });
  assert.equal(result.diagnostics.length, 6);
  assert.deepEqual(result.diagnostics.map((item) => item.model), [
    'missingOutput',
    'negative',
    'nan',
    'object',
    'extra',
    ' spaced '
  ]);
});

test('rejects a non-object pricing root', () => {
  const result = validateModelPricingUsdPerMTok(null);

  assert.deepEqual({ ...result.pricing }, {});
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.model, undefined);
});

test('calculates uncached, cached, and output cost per million tokens', () => {
  const { pricing } = validateModelPricingUsdPerMTok({
    'gpt-5.6-sol': { input: 5, cachedInput: 0.5, output: 30 }
  });
  const cost = calculateUsageCostUsd('gpt-5.6-sol', {
    input_tokens: 1_000_000,
    input_tokens_details: { cached_tokens: 250_000 },
    output_tokens: 100_000,
    total_tokens: 1_100_000
  }, pricing);

  assert.deepEqual(cost, {
    uncachedInput: 3.75,
    cachedInput: 0.125,
    output: 3,
    total: 6.875
  });
});

test('clamps cached tokens and normalizes malformed token counts', () => {
  assert.deepEqual(getUsageBreakdown({
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 200 },
    output_tokens: -4,
    total_tokens: Number.NaN
  }), {
    inputTokens: 100,
    cachedInputTokens: 100,
    uncachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 100
  });
});

test('returns no cost for an unconfigured model', () => {
  assert.equal(calculateUsageCostUsd('unknown', { input_tokens: 1 }, {}), undefined);
});

test('formats token summaries and USD values for the UI', () => {
  assert.equal(formatUsageTokens({ input_tokens: 10, output_tokens: 3, total_tokens: 13 }), 'input 10, output 3, total 13');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(12.345), '$12.35');
  assert.equal(formatUsd(0.125), '$0.1250');
  assert.equal(formatUsd(0.00125), '$0.001250');
  assert.equal(formatUsd(0.0000001), '<$0.000001');
  assert.throws(() => formatUsd(-1), /finite and non-negative/);
});
