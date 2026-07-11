import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProviderModels, parseModelIdentifier } from '../src/models.js';
import { baseConfig } from './helpers.js';

test('buildProviderModels offers normal and fast entries per discovered model', () => {
  const models = buildProviderModels(baseConfig, [
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', context_window: 372000, service_tiers: ['normal', 'fast'] },
    { slug: 'gpt-5.5', display_name: 'Codex 5.5', context_window: 272000, service_tiers: ['normal', 'fast'] },
    { slug: 'gpt-5.4', display_name: 'Codex 5.4', context_window: 272000 },
    { slug: 'gpt-5.4-mini', display_name: 'Codex 5.4 Mini', context_window: 272000, feature_requirements: { fast: true } }
  ]);

  assert.deepEqual(models.map((model) => model.info.name), [
    'GPT-5.6-Sol',
    'GPT-5.6-Sol Fast',
    'Codex 5.5',
    'Codex 5.5 Fast',
    'Codex 5.4',
    'Codex 5.4 Fast',
    'Codex 5.4 Mini',
    'Codex 5.4 Mini Fast'
  ]);
  assert.deepEqual(models.map((model) => model.serviceTier ?? 'normal'), [
    'normal',
    'fast',
    'normal',
    'fast',
    'normal',
    'fast',
    'normal',
    'fast'
  ]);
  assert.deepEqual(models.map((model) => parseModelIdentifier(model.info.id).requestModel), [
    'gpt-5.6-sol',
    'gpt-5.6-sol',
    'gpt-5.5',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-mini'
  ]);
  assert.deepEqual(models.map((model) => parseModelIdentifier(model.info.id).serviceTier ?? 'normal'), [
    'normal',
    'fast',
    'normal',
    'fast',
    'normal',
    'fast',
    'normal',
    'fast'
  ]);
});

test('buildProviderModels uses normal and fast fallback models when discovery is unavailable', () => {
  const models = buildProviderModels(baseConfig, []);

  assert.deepEqual(models.map((model) => model.info.name), [
    'GPT-5.6-Sol',
    'GPT-5.6-Sol Fast',
    'GPT-5.6-Terra',
    'GPT-5.6-Terra Fast',
    'GPT-5.6-Luna',
    'GPT-5.6-Luna Fast',
    'GPT-5.5',
    'GPT-5.5 Fast',
    'GPT-5.4',
    'GPT-5.4 Fast',
    'GPT-5.4-Mini',
    'GPT-5.4-Mini Fast'
  ]);
  assert.deepEqual(models.map((model) => model.serviceTier ?? 'normal'), [
    'normal',
    'fast',
    'normal',
    'fast',
    'normal',
    'fast',
    'normal',
    'fast',
    'normal',
    'fast',
    'normal',
    'fast'
  ]);
  assert.deepEqual(models.map((model) => parseModelIdentifier(model.info.id).requestModel), [
    'gpt-5.6-sol',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-mini'
  ]);
  assert.equal(parseModelIdentifier('codex::gpt-5.6-sol::tier=fast').serviceTier, 'fast');
});

test('buildProviderModels advertises image input when discovered model supports images', () => {
  const [model, fastModel] = buildProviderModels(baseConfig, [
    { slug: 'gpt-5.5', input_modalities: ['text', 'image'] }
  ]);

  assert.equal(model.info.capabilities?.imageInput, true);
  assert.equal(fastModel.info.capabilities?.imageInput, true);
  assert.deepEqual(fastModel.info.capabilities, model.info.capabilities);
});

test('buildProviderModels exposes discovered reasoning levels as model configuration', () => {
  const [model, fastModel] = buildProviderModels(baseConfig, [
    {
      slug: 'gpt-5.5',
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Lower latency.' },
        { effort: 'high', description: 'More thorough.' },
        { effort: 'max', description: 'Maximum reasoning.' },
        { effort: 'ultra', description: 'Delegated maximum reasoning.' }
      ]
    }
  ]);

  const modelInfo = model.info as typeof model.info & {
    configurationSchema?: { properties?: { reasoningEffort?: unknown } };
  };
  const fastModelInfo = fastModel.info as typeof fastModel.info & {
    configurationSchema?: { properties?: { reasoningEffort?: unknown } };
  };
  const reasoningEffort = modelInfo.configurationSchema?.properties?.reasoningEffort as {
    enum?: string[];
    default?: string;
  } | undefined;
  assert.deepEqual(reasoningEffort?.enum, ['medium', 'low', 'high', 'max', 'ultra']);
  assert.equal(reasoningEffort?.default, 'medium');
  assert.deepEqual(fastModelInfo.configurationSchema, modelInfo.configurationSchema);
});
