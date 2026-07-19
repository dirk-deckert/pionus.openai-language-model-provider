import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countInputTokens, ResponsesTransportError } from '../src/responsesClient.js';

const NEVER_CANCELLED_TOKEN = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined })
};

async function withMockFetch<T>(mockFetch: typeof fetch, body: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await body();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('exact input-token counting sends the converted input policy to the endpoint', async () => {
  let calls = 0;
  const input = [
    { role: 'user', type: 'message', content: 'Describe this image.' },
    {
      role: 'user',
      type: 'message',
      content: [{ type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,AQID' }]
    }
  ] as never;

  await withMockFetch(async (url, init) => {
    calls += 1;
    assert.equal(String(url), 'https://models.example.test/v1/responses/input_tokens');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fake-test-token');
    assert.equal(new Headers(init?.headers).get('x-test-account'), 'account-1');
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'gpt-5.6-sol', input });
    assert.equal(init?.signal?.aborted, false);
    return new Response(JSON.stringify({ input_tokens: 1234.9 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }, async () => {
    const count = await countInputTokens({
      baseURL: 'https://models.example.test/v1/responses',
      apiKey: 'fake-test-token',
      headers: { 'X-Test-Account': 'account-1' },
      model: 'gpt-5.6-sol',
      input,
      token: NEVER_CANCELLED_TOKEN as never
    });
    assert.equal(count, 1234);
  });

  assert.equal(calls, 1, 'the mocked endpoint must be the only network boundary exercised');
});

test('exact input-token counting supports the ChatGPT Codex endpoint and account header', async () => {
  await withMockFetch(async (url, init) => {
    assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/responses/input_tokens');
    assert.equal(new Headers(init?.headers).get('chatgpt-account-id'), 'account-1');
    return new Response(JSON.stringify({ input_tokens: 42 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }, async () => {
    const count = await countInputTokens({
      baseURL: 'https://chatgpt.com/backend-api/codex/responses',
      apiKey: 'fake-chatgpt-token',
      headers: { 'ChatGPT-Account-ID': 'account-1' },
      model: 'gpt-5.6-sol',
      input: 'hello',
      token: NEVER_CANCELLED_TOKEN as never
    });
    assert.equal(count, 42);
  });
});

test('input-token endpoint failures retain provider error categories and causes', async () => {
  const cases = [
    { status: 401, body: { error: { code: 'invalid_api_key', message: 'Bad fake key.' } }, kind: 'noPermissions' },
    { status: 404, body: { error: { code: 'model_not_found', message: 'Model does not exist.' } }, kind: 'notFound' },
    { status: 429, body: { error: { code: 'insufficient_quota', message: 'Fake quota exhausted.' } }, kind: 'blocked' },
    { status: 503, body: { error: { code: 'server_error', message: 'Fake backend unavailable.' } }, kind: 'server' }
  ] as const;

  for (const expected of cases) {
    await withMockFetch(async () => new Response(JSON.stringify(expected.body), {
      status: expected.status,
      statusText: 'Test Failure',
      headers: { 'Content-Type': 'application/json' }
    }), async () => {
      await assert.rejects(countInputTokens({
        baseURL: 'https://models.example.test/v1',
        apiKey: 'fake-test-token',
        model: 'gpt-5.6-sol',
        input: 'hello',
        token: NEVER_CANCELLED_TOKEN as never
      }), (error) => {
        assert.ok(error instanceof ResponsesTransportError);
        assert.equal(error.kind, expected.kind);
        assert.equal(error.status, expected.status);
        assert.match(error.message, /responses\/input_tokens/);
        return true;
      });
    });
  }
});

test('input-token counting rejects malformed successful responses', async () => {
  for (const payload of [
    {},
    { input_tokens: '12' },
    { input_tokens: -1 },
    { input_tokens: Number.NaN }
  ]) {
    await withMockFetch(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }), async () => {
      await assert.rejects(countInputTokens({
        baseURL: 'https://models.example.test/v1',
        apiKey: 'fake-test-token',
        model: 'gpt-5.6-sol',
        input: 'hello',
        token: NEVER_CANCELLED_TOKEN as never
      }), (error) => error instanceof ResponsesTransportError && error.kind === 'malformed');
    });
  }
});

test('input-token counting binds VS Code cancellation to the fetch signal', async () => {
  let cancelled = false;
  let cancellationListener: (() => void) | undefined;
  let observedSignal: AbortSignal | undefined;
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested(listener: () => void) {
      cancellationListener = listener;
      return { dispose: () => undefined };
    }
  };

  await withMockFetch((_url, init) => {
    observedSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      observedSignal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    });
  }, async () => {
    const pending = countInputTokens({
      baseURL: 'https://models.example.test/v1',
      apiKey: 'fake-test-token',
      model: 'gpt-5.6-sol',
      input: 'hello',
      token: token as never
    });
    cancelled = true;
    cancellationListener?.();

    await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(observedSignal?.aborted, true);
  });
});
