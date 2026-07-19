import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyCredentialTarget,
  clearApiKey,
  getApiCredentials,
  getCredentialSecretKey,
  setApiKey
} from '../src/secrets.js';

const LEGACY_SECRET_KEY = 'pionus.codex.apiKey';

interface SecretOperations {
  reads: string[];
  stores: Array<[string, string]>;
  deletes: string[];
}

function createSecretContext(values: Readonly<Record<string, string | undefined>>): {
  context: unknown;
  operations: SecretOperations;
} {
  const operations: SecretOperations = { reads: [], stores: [], deletes: [] };
  return {
    context: {
      secrets: {
        get: async (key: string) => {
          operations.reads.push(key);
          return values[key];
        },
        store: async (key: string, value: string) => {
          operations.stores.push([key, value]);
        },
        delete: async (key: string) => {
          operations.deletes.push(key);
        }
      }
    },
    operations
  };
}

test('legacy SecretStorage keys migrate to each official endpoint-specific key', async () => {
  for (const baseURL of [
    'https://chatgpt.com/backend-api/codex/responses',
    'https://api.openai.com/v1/responses'
  ]) {
    const targetKey = getCredentialSecretKey(classifyCredentialTarget(baseURL));
    const { context, operations } = createSecretContext({
      [LEGACY_SECRET_KEY]: '  fake-legacy-token  '
    });

    const credentials = await getApiCredentials(context as never, baseURL, 'secretStorage');

    assert.deepEqual(operations.reads, [targetKey, LEGACY_SECRET_KEY]);
    assert.deepEqual(operations.stores, [[targetKey, 'fake-legacy-token']]);
    assert.deepEqual(operations.deletes, []);
    assert.deepEqual(credentials, {
      apiKey: 'fake-legacy-token',
      headers: { 'User-Agent': 'pionus.openai-language-model-provider/0.1.0 VSCode-Extension' },
      source: 'secretStorage',
      omitMaxOutputTokens: false
    });
  }
});

test('an endpoint-specific secret takes precedence without reading or rewriting the legacy key', async () => {
  const baseURL = 'https://api.openai.com/v1/responses';
  const targetKey = getCredentialSecretKey(classifyCredentialTarget(baseURL));
  const { context, operations } = createSecretContext({
    [targetKey]: 'fake-current-token',
    [LEGACY_SECRET_KEY]: 'fake-legacy-token'
  });

  const credentials = await getApiCredentials(context as never, baseURL, 'secretStorage');

  assert.equal(credentials?.apiKey, 'fake-current-token');
  assert.deepEqual(operations.reads, [targetKey]);
  assert.deepEqual(operations.stores, []);
});

test('set and clear operations retain endpoint isolation and clean up the official legacy key', async () => {
  const officialURL = 'https://api.openai.com/v1/responses';
  const officialTargetKey = getCredentialSecretKey(classifyCredentialTarget(officialURL));
  const official = createSecretContext({});
  await setApiKey(official.context as never, officialURL, 'fake-new-token');
  await clearApiKey(official.context as never, officialURL);
  assert.deepEqual(official.operations.stores, [[officialTargetKey, 'fake-new-token']]);
  assert.deepEqual(official.operations.deletes, [officialTargetKey, LEGACY_SECRET_KEY]);

  const customURL = 'https://models.example.test/v1/responses';
  const customTargetKey = getCredentialSecretKey(classifyCredentialTarget(customURL));
  const custom = createSecretContext({});
  await setApiKey(custom.context as never, customURL, 'fake-custom-token');
  await clearApiKey(custom.context as never, customURL);
  assert.deepEqual(custom.operations.stores, [[customTargetKey, 'fake-custom-token']]);
  assert.deepEqual(custom.operations.deletes, [customTargetKey]);
});
