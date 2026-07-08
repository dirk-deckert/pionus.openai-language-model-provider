import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildResponsesCreateRequest } from '../src/responsesClient.js';

const LANGUAGE_MODEL_CHAT_TOOL_MODE_REQUIRED = 2;

test('buildResponsesCreateRequest includes provider options and host tools', () => {
  const request = buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Be useful.',
    input: [{ role: 'user', type: 'message', content: 'Hello' } as never],
    serviceTier: 'priority',
    reasoning: { effort: 'high' },
    maxOutputTokens: 4096,
    previousResponseId: 'resp_123',
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
  assert.equal(request.store, true);
  assert.equal(request.service_tier, 'priority');
  assert.deepEqual(request.reasoning, { effort: 'high' });
  assert.equal(request.max_output_tokens, 4096);
  assert.equal(request.previous_response_id, 'resp_123');
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

test('buildResponsesCreateRequest stores continuation requests', () => {
  const request = buildResponsesCreateRequest({
    model: 'gpt-5.5',
    instructions: 'Finish.',
    input: [{ type: 'function_call_output', call_id: 'call_123', output: 'contents' } as never],
    maxOutputTokens: 4096,
    previousResponseId: 'resp_123'
  });

  assert.equal(request.store, true);
  assert.equal(request.previous_response_id, 'resp_123');
});
