import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampOutputTokens, ensureSupportedReasoningEffort, resolveReasoningEffort } from '../src/providerOptions.js';

test('reasoning selection follows runtime, model, variant, profile, global, and backend precedence', () => {
  const defaults = {
    selectedVariant: 'high' as const,
    agentProfile: 'medium' as const,
    globalDefault: 'low' as const,
    modelDefault: 'minimal' as const
  };
  assert.equal(resolveReasoningEffort({ runtimeOptions: { modelConfiguration: { reasoningEffort: 'xhigh' } }, ...defaults }), 'xhigh');
  assert.equal(resolveReasoningEffort({
    runtimeOptions: {
      configuration: { reasoningEffort: 'high' },
      modelOptions: { reasoningEffort: 'max', reasoning: { effort: 'ultra' } }
    },
    ...defaults
  }), 'high');
  assert.equal(resolveReasoningEffort({ runtimeOptions: { modelOptions: { reasoningEffort: 'max' } }, ...defaults }), 'max');
  assert.equal(resolveReasoningEffort({ runtimeOptions: { modelOptions: { reasoning: { effort: 'ultra' } } }, ...defaults }), 'ultra');
  assert.equal(resolveReasoningEffort({ runtimeOptions: {}, ...defaults }), 'high');
  assert.equal(resolveReasoningEffort({ runtimeOptions: {}, agentProfile: 'medium', globalDefault: 'low', modelDefault: 'minimal' }), 'medium');
  assert.equal(resolveReasoningEffort({ runtimeOptions: {}, globalDefault: 'low', modelDefault: 'minimal' }), 'low');
  assert.equal(resolveReasoningEffort({ runtimeOptions: {}, modelDefault: 'minimal' }), 'minimal');
  assert.equal(resolveReasoningEffort({
    runtimeOptions: { modelConfiguration: { reasoningEffort: 'unsupported' } },
    selectedVariant: 'low'
  }), 'low');
});

test('output token limit is clamped only when the model maximum is known', () => {
  assert.equal(clampOutputTokens(8192, 4096), 4096);
  assert.equal(clampOutputTokens(8192, 128000), 8192);
  assert.equal(clampOutputTokens(8192, undefined), 8192);
});

test('effective model metadata rejects unsupported reasoning without guessing unknown endpoints', () => {
  assert.equal(ensureSupportedReasoningEffort('high', {
    model: 'gpt-5.4',
    known: true,
    supported: ['none', 'low', 'medium', 'high', 'xhigh']
  }), 'high');
  assert.throws(() => ensureSupportedReasoningEffort('max', {
    model: 'gpt-5.4',
    known: true,
    supported: ['none', 'low', 'medium', 'high', 'xhigh']
  }), /effective model "gpt-5\.4"/);
  assert.equal(ensureSupportedReasoningEffort('max', {
    model: 'custom-unknown',
    known: false,
    supported: []
  }), 'max');
});
