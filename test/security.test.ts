import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  classifyCredentialTarget,
  getApiCredentials,
  getCredentialSecretKey,
  selectCodexAuthCredentials
} from '../src/secrets.js';
import { resolveCliExecutable, toShellCommand } from '../src/cliBridge.js';
import { baseConfig } from './helpers.js';

test('binds Codex auth credentials to their official endpoints', () => {
  const auth = {
    OPENAI_API_KEY: 'sk-openai',
    tokens: { access_token: 'chatgpt-token', account_id: 'account-1' }
  };

  assert.equal(selectCodexAuthCredentials(auth, classifyCredentialTarget('https://chatgpt.com/backend-api/codex/responses'))?.apiKey, 'chatgpt-token');
  assert.equal(selectCodexAuthCredentials(auth, classifyCredentialTarget('https://api.openai.com/v1/responses'))?.apiKey, 'sk-openai');
  assert.equal(selectCodexAuthCredentials(auth, classifyCredentialTarget('https://models.example.test/v1')), undefined);
  assert.equal(selectCodexAuthCredentials(auth, classifyCredentialTarget('https://chatgpt.com.evil.test/backend-api/codex')), undefined);
  assert.equal(selectCodexAuthCredentials(auth, classifyCredentialTarget('https://chatgpt.com:444/backend-api/codex')), undefined);
});

test('rejects insecure credential endpoints and isolates custom endpoint secrets', () => {
  assert.throws(() => classifyCredentialTarget('http://chatgpt.com/backend-api/codex/responses'), /HTTPS/);
  assert.throws(() => classifyCredentialTarget('https://user:password@chatgpt.com/backend-api/codex/responses'), /embedded user/);
  assert.notEqual(
    getCredentialSecretKey(classifyCredentialTarget('https://models-a.example.test/v1')),
    getCredentialSecretKey(classifyCredentialTarget('https://models-b.example.test/v1'))
  );
});

test('custom endpoints cannot fall back to a legacy official credential', async () => {
  const reads: string[] = [];
  const context = {
    secrets: {
      get: async (key: string) => {
        reads.push(key);
        return key === 'pionus.codex.apiKey' ? 'legacy-official-secret' : undefined;
      },
      store: async () => undefined,
      delete: async () => undefined
    }
  };

  const credentials = await getApiCredentials(context as never, 'https://models.example.test/v1', 'auto');
  assert.equal(credentials, undefined);
  assert.equal(reads.includes('pionus.codex.apiKey'), false);
});

test('quotes hostile CLI executable settings as one shell word', () => {
  const executable = resolveCliExecutable({ ...baseConfig, cliExecutable: 'codex; touch /tmp/pionus-injected' });
  assert.equal(toShellCommand({ executable, args: ['review'], mutates: false }), "'codex; touch /tmp/pionus-injected' review");
});

test('terminal launch does not interpolate the executable into a shell probe', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'extension.ts'), 'utf8');
  assert.doesNotMatch(source, /command -v/);
  assert.match(source, /terminal\.sendText\(command\)/);
});

test('credential destinations and CLI controls cannot be overridden by a workspace', async () => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
  const properties = manifest.contributes.configuration.properties;
  assert.equal(properties['pionus.codex.baseURL'].scope, 'application');
  assert.equal(properties['pionus.codex.credentialsSource'].scope, 'application');
  assert.equal(properties['pionus.codex.enableCliBridge'].scope, 'application');
  assert.equal(properties['pionus.codex.cliExecutable'].scope, 'machine');
});
