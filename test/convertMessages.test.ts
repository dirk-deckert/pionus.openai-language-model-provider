import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertMessagesToResponsesInput, estimateTokenCount } from '../src/convertMessages.js';

const USER_ROLE = 1;
const ASSISTANT_ROLE = 2;
const textEncoder = new TextEncoder();

test('convertMessagesToResponsesInput converts text and text data parts into messages', () => {
  const input = convertMessagesToResponsesInput([
    {
      role: USER_ROLE,
      content: [
        { value: 'Read this: ' },
        { mimeType: 'text/markdown', data: textEncoder.encode('# Title') }
      ]
    }
  ] as never, false);

  assert.deepEqual(input, [
    { role: 'user', content: 'Read this: # Title', type: 'message' }
  ]);
});

test('convertMessagesToResponsesInput forwards enabled image data as input_image', () => {
  const input = convertMessagesToResponsesInput([
    {
      role: USER_ROLE,
      content: [
        { value: 'Look' },
        { mimeType: 'image/png', data: Uint8Array.from([1, 2, 3]) }
      ]
    }
  ] as never, true);

  assert.deepEqual(input, [
    { role: 'user', content: 'Look', type: 'message' },
    {
      role: 'user',
      type: 'message',
      content: [
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,AQID'
        }
      ]
    }
  ]);
});

test('convertMessagesToResponsesInput serializes unsupported binary data as placeholders', () => {
  const input = convertMessagesToResponsesInput([
    {
      role: USER_ROLE,
      content: [
        { mimeType: 'application/octet-stream', data: Uint8Array.from([1, 2, 3, 4]) }
      ]
    }
  ] as never, false);

  assert.deepEqual(input, [
    { role: 'user', content: '[binary data: application/octet-stream, 4 bytes]', type: 'message' }
  ]);
});

test('convertMessagesToResponsesInput converts tool calls and tool results', () => {
  const input = convertMessagesToResponsesInput([
    {
      role: ASSISTANT_ROLE,
      content: [
        { callId: 'call_1', name: 'read_file', input: { path: 'README.md' } }
      ]
    },
    {
      role: USER_ROLE,
      content: [
        { callId: 'call_1', content: [{ value: 'contents' }] }
      ]
    }
  ] as never, false);

  assert.deepEqual(input, [
    { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'contents' }
  ]);
});

test('estimateTokenCount handles empty converted messages', () => {
  assert.equal(estimateTokenCount({ role: USER_ROLE, content: [] } as never), 0);
});