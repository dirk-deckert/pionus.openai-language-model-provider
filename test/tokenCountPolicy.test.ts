import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResponsesTransportError } from '../src/responsesClient.js';
import {
  INPUT_TOKEN_SUPPORT_TTL_MS,
  InputTokenEndpointSupportCache,
  isDefinitivelyUnsupportedInputTokenEndpoint
} from '../src/tokenCountPolicy.js';

test('input-token endpoint support cache normalizes URLs and expires after ten minutes', () => {
  let now = 1_000;
  const cache = new InputTokenEndpointSupportCache(() => now);
  cache.markUnsupported('https://chatgpt.com/backend-api/codex/responses');

  assert.equal(cache.canAttempt('https://chatgpt.com/backend-api/codex'), false);
  now += INPUT_TOKEN_SUPPORT_TTL_MS - 1;
  assert.equal(cache.canAttempt('https://chatgpt.com/backend-api/codex/responses'), false);
  now += 1;
  assert.equal(cache.canAttempt('https://chatgpt.com/backend-api/codex/responses'), true);

  cache.markSupported('https://chatgpt.com/backend-api/codex');
  assert.equal(cache.get('https://chatgpt.com/backend-api/codex/responses'), 'supported');
});

test('only definitive endpoint failures disable exact token counting', () => {
  const error = (kind: ConstructorParameters<typeof ResponsesTransportError>[0], status: number) =>
    new ResponsesTransportError(kind, 'test', { status });

  assert.equal(isDefinitivelyUnsupportedInputTokenEndpoint(error('failed', 404)), true);
  assert.equal(isDefinitivelyUnsupportedInputTokenEndpoint(error('notFound', 404)), false);
  assert.equal(isDefinitivelyUnsupportedInputTokenEndpoint(error('failed', 405)), true);
  assert.equal(isDefinitivelyUnsupportedInputTokenEndpoint(error('server', 501)), true);
  assert.equal(isDefinitivelyUnsupportedInputTokenEndpoint(error('noPermissions', 401)), false);
  assert.equal(isDefinitivelyUnsupportedInputTokenEndpoint(error('blocked', 429)), false);
  assert.equal(isDefinitivelyUnsupportedInputTokenEndpoint(error('transport', 503)), false);
  assert.equal(isDefinitivelyUnsupportedInputTokenEndpoint(new DOMException('cancelled', 'AbortError')), false);
});

test('transient, authentication, rate-limit, and cancellation failures do not poison retries', () => {
  const cache = new InputTokenEndpointSupportCache();
  const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
  for (const error of [
    new ResponsesTransportError('transport', 'connection failed'),
    new ResponsesTransportError('noPermissions', 'authentication failed', { status: 401 }),
    new ResponsesTransportError('blocked', 'rate limited', { status: 429 }),
    new DOMException('cancelled', 'AbortError')
  ]) {
    assert.equal(cache.recordFailure(endpoint, error), false);
    assert.equal(cache.canAttempt(endpoint), true);
  }

  assert.equal(cache.recordFailure(endpoint, new ResponsesTransportError('failed', 'route missing', { status: 404 })), true);
  assert.equal(cache.canAttempt(endpoint), false);
});
