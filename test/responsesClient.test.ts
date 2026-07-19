import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildResponsesCreateRequest,
  classifyResponsesError,
  consumeResponseStreamEvents,
  handleResponseStreamEvent,
  parseToolCallInput,
  ResponsesTransportError
} from '../src/responsesClient.js';

const LANGUAGE_MODEL_CHAT_TOOL_MODE_AUTO = 1;
const LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED = 2;

test('buildResponsesCreateRequest includes provider options and host tools', () => {
  const request = buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [{ role: 'user', type: 'message', content: 'Hello' } as never],
    serviceTier: 'priority',
    reasoning: { effort: 'high' },
    maxOutputTokens: 4096,
    toolMode: LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED,
    tools: [
      {
        name: 'read_file',
        description: 'Read a file.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          }
        }
      }
    ]
  });

  assert.equal(request.model, 'gpt-5.5');
  assert.equal(request.instructions, 'Be useful.');
  assert.equal(request.stream, true);
  assert.equal(request.store, false);
  assert.equal(request.service_tier, 'priority');
  assert.deepEqual(request.reasoning, { effort: 'high' });
  assert.equal(request.max_output_tokens, 4096);
  assert.equal(request.tool_choice, 'required');
  assert.deepEqual(request.tools, [
    {
      type: 'function',
      name: 'read_file',
      description: 'Read a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        }
      },
      strict: false
    }
  ]);
});

test('buildResponsesCreateRequest omits optional fields when disabled', () => {
  const request = buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [],
    maxOutputTokens: 4096,
    omitMaxOutputTokens: true
  });

  assert.equal('max_output_tokens' in request, false);
  assert.equal('tools' in request, false);
  assert.equal('tool_choice' in request, false);
  assert.equal('reasoning' in request, false);
  assert.equal('previous_response_id' in request, false);
});

test('buildResponsesCreateRequest rejects illegal tool names and non-object schemas', () => {
  assert.throws(() => buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [],
    maxOutputTokens: 4096,
    tools: [{ name: 'bad.name', description: 'Invalid function name.', inputSchema: { type: 'object' } }] as never
  }), /Invalid language model tool name/);

  assert.throws(() => buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [],
    maxOutputTokens: 4096,
    tools: [{ name: 'valid_name', description: 'Invalid schema.', inputSchema: true }] as never
  }), /schema must be a JSON object/);
});

test('buildResponsesCreateRequest enforces exact Auto and Required tool modes', () => {
  const auto = buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [],
    maxOutputTokens: 4096,
    toolMode: LANGUAGE_MODEL_CHAT_TOOL_MODE_AUTO,
    tools: [{ name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object' } }]
  });
  assert.equal(auto.tool_choice, 'auto');

  assert.throws(() => buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [],
    maxOutputTokens: 4096,
    toolMode: LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED,
    tools: []
  }), /Required requires at least one tool/);

  assert.throws(() => buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [],
    maxOutputTokens: 4096,
    toolMode: 99 as never,
    tools: [{ name: 'read_file', description: 'Read a file.', inputSchema: { type: 'object' } }]
  }), /Unsupported language model tool mode/);
});

test('buildResponsesCreateRequest rejects duplicate names and non-JSON schemas', () => {
  const cyclic: Record<string, unknown> = { type: 'object' };
  cyclic.self = cyclic;

  assert.throws(() => buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [],
    maxOutputTokens: 4096,
    tools: [{ name: 'cyclic', description: 'Cyclic.', inputSchema: cyclic }]
  }), /cyclic values/);

  assert.throws(() => buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [],
    maxOutputTokens: 4096,
    tools: [
      { name: 'same', description: 'First.', inputSchema: { type: 'object' } },
      { name: 'same', description: 'Second.', inputSchema: { type: 'object' } }
    ]
  }), /Duplicate language model tool name/);
});

test('parseToolCallInput accepts object arguments and rejects malformed completed arguments', () => {
  assert.deepEqual(parseToolCallInput('{"path":"README.md"}'), { path: 'README.md' });
  assert.throws(() => parseToolCallInput(''), /empty function-call arguments/);
  assert.throws(() => parseToolCallInput('{bad'), (error) => {
    assert.ok(error instanceof ResponsesTransportError);
    assert.equal(error.kind, 'malformed');
    return true;
  });
  assert.throws(() => parseToolCallInput('[1,2,3]'), /malformed function-call arguments/);
});

test('handleResponseStreamEvent maps text, reasoning, refusal, tools, completion, and diagnostics', () => {
  const seen: string[] = [];
  const callbacks = {
    onTextDelta: (value: string) => seen.push(`text:${value}`),
    onReasoningSummaryDelta: (value: string) => seen.push(`summary:${value}`),
    onReasoningTextDelta: (value: string) => seen.push(`reasoning:${value}`),
    onRefusalDelta: (value: string) => seen.push(`refusal:${value}`),
    onToolCall: (callId: string, name: string, input: object) => seen.push(`tool:${callId}:${name}:${JSON.stringify(input)}`),
    onResponseCompleted: () => seen.push('completed'),
    onUnhandledEvent: (type: string) => seen.push(`unknown:${type}`)
  };

  handleResponseStreamEvent({ type: 'response.output_text.delta', delta: 'answer' } as never, callbacks);
  handleResponseStreamEvent({ type: 'response.reasoning_summary_text.delta', delta: 'summary' } as never, callbacks);
  handleResponseStreamEvent({ type: 'response.reasoning_text.delta', delta: 'reasoning' } as never, callbacks);
  handleResponseStreamEvent({ type: 'response.refusal.delta', delta: 'no' } as never, callbacks);
  handleResponseStreamEvent({
    type: 'response.output_item.done',
    item: { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' }
  } as never, callbacks);
  assert.equal(handleResponseStreamEvent({ type: 'response.completed', response: {} } as never, callbacks), 'completed');
  handleResponseStreamEvent({ type: 'response.future_event' } as never, callbacks);

  assert.deepEqual(seen, [
    'text:answer',
    'summary:summary',
    'reasoning:reasoning',
    'refusal:no',
    'tool:call_1:read_file:{"path":"README.md"}',
    'completed',
    'unknown:response.future_event'
  ]);
});

test('consumeResponseStreamEvents handles a deterministic mocked event stream', async () => {
  const seen: string[] = [];
  async function* stream() {
    yield { type: 'response.output_text.delta', delta: 'one' } as never;
    yield { type: 'response.output_text.delta', delta: ' two' } as never;
    yield { type: 'response.completed', response: {} } as never;
  }

  await consumeResponseStreamEvents(stream(), {
    onTextDelta: (text) => seen.push(text),
    onResponseCompleted: () => seen.push('completed')
  }, {
    isCancellationRequested: () => false,
    cancel: () => assert.fail('completed stream should not be cancelled')
  });

  assert.deepEqual(seen, ['one', ' two', 'completed']);
});

test('consumeResponseStreamEvents rejects truncated streams and resolves cancellation', async () => {
  async function* truncated() {
    yield { type: 'response.output_text.delta', delta: 'partial' } as never;
  }
  await assert.rejects(() => consumeResponseStreamEvents(truncated(), {
    onTextDelta: () => undefined
  }, {
    isCancellationRequested: () => false,
    cancel: () => undefined
  }), (error) => error instanceof ResponsesTransportError && error.kind === 'malformed');

  let cancelled = false;
  await consumeResponseStreamEvents(truncated(), {
    onTextDelta: () => assert.fail('cancelled stream should not emit content')
  }, {
    isCancellationRequested: () => true,
    cancel: () => { cancelled = true; }
  });
  assert.equal(cancelled, true);
});

test('handleResponseStreamEvent surfaces failed, incomplete, and error terminal events', () => {
  const seen: string[] = [];
  const callbacks = {
    onTextDelta: () => undefined,
    onResponseFailed: (message: string) => seen.push(`failed:${message}`),
    onResponseIncomplete: (message: string) => seen.push(`incomplete:${message}`),
    onResponseError: (message: string, code?: string | null) => seen.push(`error:${code}:${message}`)
  };

  assert.throws(() => handleResponseStreamEvent({
    type: 'response.failed',
    response: { error: { code: 'rate_limit_exceeded', message: 'Quota exhausted.' } }
  } as never, callbacks), (error) => error instanceof ResponsesTransportError && error.kind === 'blocked');

  assert.throws(() => handleResponseStreamEvent({
    type: 'response.incomplete',
    response: { incomplete_details: { reason: 'max_output_tokens' } }
  } as never, callbacks), (error) => error instanceof ResponsesTransportError
    && error.kind === 'incomplete'
    && /max_output_tokens/.test(error.message));

  assert.throws(() => handleResponseStreamEvent({
    type: 'error',
    code: 'server_error',
    message: 'Backend failed.',
    param: null
  } as never, callbacks), (error) => error instanceof ResponsesTransportError && error.kind === 'failed');

  assert.throws(() => handleResponseStreamEvent({
    type: 'error',
    code: 'invalid_api_key',
    message: 'Authentication failed.',
    param: null
  } as never, callbacks), (error) => error instanceof ResponsesTransportError && error.kind === 'noPermissions');

  assert.deepEqual(seen, [
    'failed:Quota exhausted.',
    'incomplete:Responses API request was incomplete: max_output_tokens.',
    'error:server_error:Backend failed.',
    'error:invalid_api_key:Authentication failed.'
  ]);
});

test('classifyResponsesError exposes VS Code-integratable error categories', () => {
  assert.equal(classifyResponsesError({ status: 401, message: 'Unauthorized' }), 'noPermissions');
  assert.equal(classifyResponsesError({ status: 403, message: 'Forbidden' }), 'noPermissions');
  assert.equal(classifyResponsesError({ status: 404, code: 'model_not_found', message: 'Missing model' }), 'notFound');
  assert.equal(classifyResponsesError({ status: 404, message: 'Missing route' }), 'failed');
  assert.equal(classifyResponsesError({ status: 429, message: 'Slow down' }), 'blocked');
  assert.equal(classifyResponsesError({ code: 'permission_denied', message: 'Forbidden stream event' }), 'noPermissions');
  assert.equal(classifyResponsesError({ code: 'quota_exceeded', message: 'Quota stream event' }), 'blocked');
  assert.equal(classifyResponsesError({ status: 503, message: 'Unavailable' }), 'server');
  assert.equal(classifyResponsesError({ name: 'AbortError', message: 'aborted' }), 'transport');
});
