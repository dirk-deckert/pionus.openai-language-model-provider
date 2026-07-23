import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MODEL_DEFINITIONS,
  OPENAI_MODEL_CATALOG,
  OPENAI_MODEL_CATALOG_REVIEWED_AT,
  OPENAI_MODEL_GUIDANCE_URL,
  getCompatibilityFallbackDefinitions
} from '../src/modelCatalog.js';
import { buildProviderModels, fetchAvailableModels, parseModelIdentifier, resolveModelMetadata } from '../src/models.js';
import { baseConfig } from './helpers.js';

type ModelConfigurationSchema = {
  properties?: {
    reasoningEffort?: { enum?: string[]; default?: string };
  };
};

function getConfigurationSchema(model: ReturnType<typeof buildProviderModels>[number] | undefined): ModelConfigurationSchema | undefined {
  type ModelInfo = NonNullable<typeof model>['info'];
  return (model?.info as ModelInfo & { configurationSchema?: ModelConfigurationSchema } | undefined)?.configurationSchema;
}

test('default discovery exposes visible tiers without duplicating reasoning efforts', () => {
  const models = buildProviderModels(baseConfig, [
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6-Sol',
      context_window: 372000,
      service_tiers: ['normal', 'fast'],
      default_reasoning_level: 'medium',
      supported_reasoning_levels: ['low', 'medium', 'high']
    },
    { slug: 'gpt-5.5', display_name: 'Codex 5.5', context_window: 272000, service_tiers: ['normal'] }
  ]);

  assert.deepEqual(models.map((model) => model.info.id), [
    'codex::gpt-5.6-sol::tier=default',
    'codex::gpt-5.6-sol::tier=fast',
    'codex::gpt-5.5::tier=default'
  ]);
  assert.deepEqual(models.map((model) => model.info.name), [
    'GPT-5.6-Sol (Normal)',
    'GPT-5.6-Sol (Fast)',
    'Codex 5.5 (Normal)'
  ]);
  const schema = getConfigurationSchema(models[0]);
  assert.deepEqual(schema?.properties?.reasoningEffort?.enum, ['medium', 'low', 'high']);
});

test('fallback advertises only the configured model while retaining legacy ID parsing', () => {
  const models = buildProviderModels(baseConfig, []);
  assert.deepEqual(models.map((model) => model.info.id), ['codex::gpt-5.6-sol']);
  assert.equal(models[0]?.info.name, 'GPT-5.6-Sol (Auto)');
  assert.equal(models[0]?.info.maxInputTokens, 272_000);
  assert.equal(parseModelIdentifier('codex::gpt-5.6-sol::tier=fast').serviceTier, 'fast');
  assert.equal(parseModelIdentifier('codex::gpt-5.6-sol::tier=default').serviceTier, 'default');
  assert.equal(parseModelIdentifier('codex::gpt-5.6-sol::reasoning=high').reasoningEffort, 'high');
});

test('one model registry derives unique catalog and ordered compatibility fallbacks', () => {
  assert.equal(new Set(MODEL_DEFINITIONS.map((definition) => definition.id)).size, MODEL_DEFINITIONS.length);
  assert.deepEqual(getCompatibilityFallbackDefinitions().map((definition) => definition.id), [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini'
  ]);
  assert.deepEqual(OPENAI_MODEL_CATALOG.map((entry) => entry.id), MODEL_DEFINITIONS
    .filter((definition) => definition.openAI)
    .map((definition) => definition.id));
  assert.equal(MODEL_DEFINITIONS.find((definition) => definition.id === 'gpt-5.6-sol')?.fallback?.defaultReasoningEffort, 'low');
  assert.equal(OPENAI_MODEL_CATALOG.find((entry) => entry.id === 'gpt-5.6-sol')?.defaultReasoningEffort, 'medium');
});

test('ChatGPT discovery exposes tier labels only when supported or configured', () => {
  const models = buildProviderModels(baseConfig, [
    { slug: 'advertised', service_tiers: ['normal', 'fast'] },
    { slug: 'nested-priority', supported_service_tiers: [{ tier: 'priority' }] },
    { slug: 'not-advertised', service_tiers: ['normal'] },
    { slug: 'unknown' }
  ], 'chatgpt');

  assert.deepEqual(models.map((model) => model.info.id), [
    'codex::advertised::tier=default',
    'codex::advertised::tier=fast',
    'codex::nested-priority::tier=default',
    'codex::nested-priority::tier=fast',
    'codex::not-advertised::tier=default',
    'codex::unknown'
  ]);
  assert.deepEqual(models.map((model) => model.info.name), [
    'Advertised (Normal)',
    'Advertised (Fast)',
    'Nested-Priority (Normal)',
    'Nested-Priority (Fast)',
    'Not-Advertised (Normal)',
    'Unknown (Auto)'
  ]);
  assert.match(models[1]?.info.detail ?? '', /Service tier: Fast/);
  assert.match(models[5]?.info.detail ?? '', /Service tier: Auto/);
});

test('discovery visibility is credential-target aware and preserves Auto Review', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ models: [
    { slug: 'gpt-5.3-codex-spark', visibility: 'list', supported_in_api: false },
    { slug: 'codex-auto-review', visibility: 'hide', supported_in_api: true },
    { slug: 'other-hidden', visibility: 'hide', supported_in_api: true }
  ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  const credentials = { apiKey: 'fake', headers: {}, source: 'secretStorage', omitMaxOutputTokens: false } as const;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined })
  } as never;

  try {
    assert.deepEqual((await fetchAvailableModels(baseConfig, credentials, token, 'chatgpt')).map((model) => model.slug), [
      'gpt-5.3-codex-spark',
      'codex-auto-review'
    ]);
    assert.deepEqual(await fetchAvailableModels(baseConfig, credentials, token, 'openai'), []);
    assert.deepEqual((await fetchAvailableModels(baseConfig, credentials, token, 'custom')).map((model) => model.slug), [
      'gpt-5.3-codex-spark'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('endpoint-specific parsing uses ChatGPT slug, OpenAI id, and custom id-or-slug', () => {
  const payload = [
    { id: 'gpt-5.4-mini', slug: 'gpt-5.6-sol', context_window: 123_000, input_modalities: ['text'] }
  ];

  const chatgpt = buildProviderModels(baseConfig, payload, 'chatgpt');
  const openai = buildProviderModels(baseConfig, payload, 'openai');
  const custom = buildProviderModels(baseConfig, payload, 'custom');

  assert.equal(chatgpt[0]?.requestModel, 'gpt-5.6-sol');
  assert.equal(openai[0]?.requestModel, 'gpt-5.4-mini');
  assert.equal(custom[0]?.requestModel, 'gpt-5.4-mini');
  assert.equal(chatgpt[0]?.info.maxInputTokens, 123_000);
  assert.equal(openai[0]?.info.maxInputTokens, 272_000);
  assert.equal(custom[0]?.info.maxInputTokens, 123_000);
});

test('endpoint-specific discovery sends client_version only to ChatGPT Codex', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    const credentials = { apiKey: 'fake', headers: {}, source: 'secretStorage', omitMaxOutputTokens: false } as const;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => undefined })
    } as never;
    await fetchAvailableModels({ ...baseConfig, baseURL: 'https://chatgpt.com/backend-api/codex/responses', clientVersion: '1.2.3' }, credentials, token, 'chatgpt');
    await fetchAvailableModels({ ...baseConfig, baseURL: 'https://api.openai.com/v1/responses', clientVersion: '1.2.3' }, credentials, token, 'openai');
    await fetchAvailableModels({ ...baseConfig, baseURL: 'https://models.example.test/v1/responses', clientVersion: '1.2.3' }, credentials, token, 'custom');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(new URL(requested[0] ?? '').searchParams.get('client_version'), '1.2.3');
  assert.equal(new URL(requested[1] ?? '').search, '');
  assert.equal(new URL(requested[2] ?? '').search, '');
});

test('OpenAI discovery intersects exact account ids with the reviewed catalog and deduplicates', () => {
  const models = buildProviderModels(baseConfig, [
    { id: 'gpt-5.6-sol' },
    { id: 'gpt-5.6-sol' },
    { id: 'gpt-5.4-mini' },
    { id: 'gpt-unknown' },
    { slug: 'gpt-5.5' }
  ], 'openai');
  const ids = models.map((model) => model.info.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 2);
  assert.deepEqual([...new Set(models.map((model) => model.requestModel))], ['gpt-5.6-sol', 'gpt-5.4-mini']);
  assert.ok(ids.includes('codex::gpt-5.6-sol'));
  assert.ok(!ids.some((id) => id.includes('gpt-unknown')));
  assert.ok(!ids.some((id) => id.includes('gpt-5.5')));

  const sol = models.find((model) => model.info.id === 'codex::gpt-5.6-sol');
  const mini = models.find((model) => model.info.id === 'codex::gpt-5.4-mini');
  assert.equal(sol?.info.maxInputTokens, 922_000);
  assert.equal(sol?.info.maxOutputTokens, 128_000);
  assert.equal(sol?.info.capabilities?.imageInput, true);
  assert.equal(sol?.info.capabilities?.toolCalling, true);
  assert.equal(sol?.metadata.sourceURL, 'https://developers.openai.com/api/docs/models/gpt-5.6-sol');
  assert.equal(sol?.metadata.reviewedAt, OPENAI_MODEL_CATALOG_REVIEWED_AT);
  assert.equal(mini?.info.maxInputTokens, 272_000);
});

test('OpenAI discovery does not advertise a catalog model absent from the account', () => {
  assert.deepEqual(buildProviderModels(baseConfig, [{ id: 'unreviewed-model' }], 'openai'), []);
  assert.deepEqual(buildProviderModels(baseConfig, [], 'openai'), []);
});

test('non-streaming catalog entries remain queryable but are excluded from the provider picker', () => {
  const metadata = resolveModelMetadata('gpt-5.5-pro', 'openai', baseConfig);
  assert.equal(metadata?.streaming, false);
  assert.deepEqual(buildProviderModels(baseConfig, [{ id: 'gpt-5.5-pro' }], 'openai'), []);
});

test('custom discovery accepts id and slug, deduplicates, and keeps conservative metadata', () => {
  const models = buildProviderModels(baseConfig, [
    {
      id: 'custom-vision',
      context_window: 80_000,
      max_output_tokens: 6_000,
      input_modalities: ['text', 'image'],
      supported_reasoning_levels: ['low', { effort: 'high', description: 'Deep.' }],
      default_reasoning_level: 'low'
    },
    { slug: 'custom-vision' },
    { slug: 'custom-text', context_window: 50_000 }
  ], 'custom');

  assert.deepEqual([...new Set(models.map((model) => model.requestModel))], ['custom-vision', 'custom-text']);
  const vision = models.find((model) => model.info.id === 'codex::custom-vision');
  assert.equal(vision?.info.maxInputTokens, 80_000);
  assert.equal(vision?.info.maxOutputTokens, 6_000);
  assert.equal(vision?.info.capabilities?.imageInput, true);
  const schema = getConfigurationSchema(vision);
  assert.deepEqual(schema?.properties?.reasoningEffort?.enum, ['low', 'high']);
  assert.equal(models.find((model) => model.info.id === 'codex::custom-text')?.info.maxOutputTokens, baseConfig.maxOutputTokens);
});

test('resolveModelMetadata supports effective profile models without capability guessing', () => {
  const openai = resolveModelMetadata('codex::gpt-5.4::reasoning=high', 'openai', baseConfig);
  assert.equal(openai?.requestModel, 'gpt-5.4');
  assert.equal(openai?.maxInputTokens, 922_000);
  assert.equal(openai?.maxOutputTokens, 128_000);
  assert.deepEqual(openai?.supportedReasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(openai?.defaultReasoningEffort, 'none');
  assert.equal(resolveModelMetadata('gpt-5.4-lookalike', 'openai', baseConfig), undefined);

  const chatgpt = resolveModelMetadata('profile-model', 'chatgpt', baseConfig, [{
    slug: 'profile-model',
    context_window: 64_000,
    max_output_tokens: 4_000,
    input_modalities: ['text', 'image'],
    default_reasoning_level: 'high'
  }]);
  assert.equal(chatgpt?.maxInputTokens, 64_000);
  assert.equal(chatgpt?.maxOutputTokens, 4_000);
  assert.equal(chatgpt?.imageInput, true);

  const customUnknown = resolveModelMetadata('custom-unknown', 'custom', baseConfig);
  assert.equal(customUnknown?.maxInputTokens, 272_000);
  assert.equal(customUnknown?.maxOutputTokens, baseConfig.maxOutputTokens);
  assert.equal(customUnknown?.imageInput, false);
});

test('reasoning is model configuration rather than duplicated picker entries', () => {
  const models = buildProviderModels(baseConfig, [{
    slug: 'gpt-5.5',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Lower latency.' },
      { effort: 'high', description: 'More thorough.' },
      { effort: 'high', description: 'Duplicate.' },
      { effort: 'max', description: 'Maximum reasoning.' },
      { effort: 'ultra', description: 'Delegated maximum reasoning.' }
    ]
  }], 'chatgpt');
  const ids = models.map((model) => model.info.id);

  assert.deepEqual(ids, ['codex::gpt-5.5']);
  assert.equal(models[0]?.info.name, 'GPT-5.5 (Auto)');
  const modelInfo = models[0]?.info as typeof models[0]['info'] & {
    configurationSchema?: { properties?: { reasoningEffort?: unknown } };
  };
  const reasoningEffort = modelInfo.configurationSchema?.properties?.reasoningEffort as {
    enum?: string[];
    default?: string;
  } | undefined;
  assert.deepEqual(reasoningEffort?.enum, ['medium', 'low', 'high', 'max', 'ultra']);
  assert.equal(reasoningEffort?.default, 'medium');
  assert.equal(parseModelIdentifier('codex::gpt-5.5::reasoning=high').reasoningEffort, 'high');
  assert.deepEqual(parseModelIdentifier('codex::gpt-5.5::reasoning=high::tier=fast'), {
    requestModel: 'gpt-5.5',
    reasoningEffort: 'high',
    serviceTier: 'fast'
  });
});

test('global tier labels unknown fallback metadata without inventing support', () => {
  const fast = buildProviderModels({ ...baseConfig, defaultServiceTier: 'fast' }, [{ slug: 'unknown' }]);
  const normal = buildProviderModels({ ...baseConfig, defaultServiceTier: 'default' }, [{ slug: 'unknown' }]);
  assert.equal(fast[0]?.info.id, 'codex::unknown::tier=fast');
  assert.equal(fast[0]?.info.name, 'Unknown (Fast)');
  assert.equal(normal[0]?.info.id, 'codex::unknown::tier=default');
  assert.equal(normal[0]?.info.name, 'Unknown (Normal)');
});

test('catalog entries record exact review and source metadata', () => {
  assert.ok(OPENAI_MODEL_CATALOG.length >= 9);
  assert.ok(OPENAI_MODEL_CATALOG.every((entry) => entry.reviewedAt === OPENAI_MODEL_CATALOG_REVIEWED_AT));
  assert.ok(OPENAI_MODEL_CATALOG.every((entry) => entry.sourceURL.startsWith('https://developers.openai.com/api/docs/models/')));
  assert.ok(OPENAI_MODEL_CATALOG.every((entry) => entry.sourceURLs.includes(entry.sourceURL)));
  assert.ok(OPENAI_MODEL_CATALOG.every((entry) => entry.contextWindowTokens > entry.maxOutputTokens));
  assert.ok(OPENAI_MODEL_CATALOG.every((entry) => entry.toolCalling && entry.imageInput));
  for (const modelId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    const entry = OPENAI_MODEL_CATALOG.find((candidate) => candidate.id === modelId);
    assert.equal(entry?.defaultReasoningEffort, 'medium');
    assert.ok(entry?.sourceURLs.includes(OPENAI_MODEL_GUIDANCE_URL));
  }
});
