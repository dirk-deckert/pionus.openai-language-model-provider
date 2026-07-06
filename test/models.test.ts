import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProviderModels, parseModelIdentifier } from '../src/models.js';
import { baseConfig } from './helpers.js';

test('buildProviderModels offers normal and fast variants for discovered models by default', () => {
  const models = buildProviderModels(baseConfig, [
    { slug: 'gpt-5.5', display_name: 'Codex 5.5', context_window: 272000 },
    { slug: 'gpt-5.4', display_name: 'Codex 5.4', context_window: 272000 },
    { slug: 'gpt-5.4-mini', display_name: 'Codex 5.4 Mini', context_window: 272000 }
  ]);

  assert.deepEqual(models.map((model) => model.info.name), [
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
    'fast'
  ]);
});

test('buildProviderModels duplicates fallback model when discovery is unavailable', () => {
  const models = buildProviderModels(baseConfig, []);

  assert.deepEqual(models.map((model) => model.info.name), ['GPT-5.5', 'GPT-5.5 Fast']);
  assert.equal(parseModelIdentifier(models[1].info.id).serviceTier, 'fast');
});