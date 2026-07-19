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
          detail: 'auto',
          image_url: 'data:image/png;base64,AQID'
        }
      ]
    }
  ]);
});

test('convertMessagesToResponsesInput normalizes JPG and supports all advertised image MIME types', () => {
  const cases = [
    ['image/jpeg', 'image/jpeg'],
    ['image/jpg', 'image/jpeg'],
    ['image/webp', 'image/webp'],
    ['image/gif', 'image/gif']
  ];

  for (const [provided, expected] of cases) {
    const input = convertMessagesToResponsesInput([
      {
        role: USER_ROLE,
        content: [{ mimeType: provided, data: Uint8Array.from([255]) }]
      }
    ] as never, true);

    assert.deepEqual(input, [
      {
        role: 'user',
        type: 'message',
        content: [{ type: 'input_image', detail: 'auto', image_url: `data:${expected};base64,/w==` }]
      }
    ]);
  }
});

test('convertMessagesToResponsesInput rejects image input when the caller has not enabled it', () => {
  assert.throws(() => convertMessagesToResponsesInput([
    {
      role: USER_ROLE,
      content: [{ mimeType: 'image/png', data: Uint8Array.from([1]) }]
    }
  ] as never, false), /Image input is not enabled/);
});

test('convertMessagesToResponsesInput rejects unsupported image MIME types', () => {
  assert.throws(() => convertMessagesToResponsesInput([
    {
      role: USER_ROLE,
      content: [{ mimeType: 'image/bmp', data: Uint8Array.from([1]) }]
    }
  ] as never, true), /Unsupported image MIME type "image\/bmp"/);

  assert.throws(() => convertMessagesToResponsesInput([
    {
      role: USER_ROLE,
      content: [{ mimeType: 'image/bmp', data: Uint8Array.from([1]) }]
    }
  ] as never, false), /Unsupported image MIME type "image\/bmp"/);
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

test('convertMessagesToResponsesInput forwards supported image tool results and preserves text order', () => {
  const input = convertMessagesToResponsesInput([
    {
      role: USER_ROLE,
      content: [{
        callId: 'call_2',
        content: [
          { value: 'screenshot' },
          { mimeType: 'image/jpg', data: Uint8Array.from([1, 2, 3]) },
          { mimeType: 'application/octet-stream', data: Uint8Array.from([4]) }
        ]
      }]
    }
  ] as never, true);

  assert.deepEqual(input, [{
    type: 'function_call_output',
    call_id: 'call_2',
    output: [
      { type: 'input_text', text: 'screenshot' },
      { type: 'input_image', detail: 'auto', image_url: 'data:image/jpeg;base64,AQID' },
      { type: 'input_text', text: '[binary data: application/octet-stream, 1 bytes]' }
    ]
  }]);
});

test('estimateTokenCount handles empty converted messages', () => {
  assert.equal(estimateTokenCount({ role: USER_ROLE, content: [] } as never), 0);
});
