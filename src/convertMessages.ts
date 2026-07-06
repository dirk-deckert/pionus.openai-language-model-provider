import type { ResponseInputItem } from 'openai/resources/responses/responses';
import * as vscode from 'vscode';

export type ResponsesInputMessage = ResponseInputItem;

const textDecoder = new TextDecoder();
const USAGE_DATA_PART_MIME = 'usage';

export function convertMessagesToResponsesInput(messages: readonly vscode.LanguageModelChatRequestMessage[], enableImageInput: boolean): ResponsesInputMessage[] {
  return messages.flatMap((message) => convertMessageToResponsesInput(message, enableImageInput));
}

export function estimateTokenCount(value: string | vscode.LanguageModelChatRequestMessage): number {
  if (typeof value === 'string') {
    return Math.ceil(value.length / 4);
  }
  const serialized = JSON.stringify(convertMessagesToResponsesInput([value], false));
  return serialized === '[]' ? 0 : Math.max(1, Math.ceil(serialized.length / 4));
}

function convertMessageToResponsesInput(message: vscode.LanguageModelChatRequestMessage, enableImageInput: boolean): ResponsesInputMessage[] {
  const items: ResponsesInputMessage[] = [];
  const role = message.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant';
  let bufferedText = '';

  const flushText = () => {
    if (!bufferedText.trim()) {
      bufferedText = '';
      return;
    }
    items.push({ role, content: bufferedText, type: 'message' } as ResponsesInputMessage);
    bufferedText = '';
  };

  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      bufferedText += part.value;
      continue;
    }

    if (part instanceof vscode.LanguageModelDataPart) {
      if (enableImageInput && isImageMime(part.mimeType)) {
        flushText();
        items.push({
          role,
          type: 'message',
          content: [
            {
              type: 'input_image',
              image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`
            }
          ]
        } as unknown as ResponsesInputMessage);
      } else {
        const serialized = serializeDataPart(part);
        if (serialized) {
          bufferedText += serialized;
        }
      }
      continue;
    }

    if (part instanceof vscode.LanguageModelToolCallPart) {
      flushText();
      items.push({
        type: 'function_call',
        call_id: part.callId,
        name: part.name,
        arguments: safeJsonStringify(part.input ?? {})
      } as ResponsesInputMessage);
      continue;
    }

    if (part instanceof vscode.LanguageModelToolResultPart) {
      flushText();
      items.push({
        type: 'function_call_output',
        call_id: part.callId,
        output: serializeToolResultContent(part.content)
      } as ResponsesInputMessage);
    }
  }

  flushText();
  return items;
}

function serializeToolResultContent(content: readonly unknown[]): string {
  return content.map((part) => {
    if (part instanceof vscode.LanguageModelTextPart) {
      return part.value;
    }
    if (part instanceof vscode.LanguageModelDataPart) {
      return serializeDataPart(part);
    }
    return safeJsonStringify(part);
  }).filter(Boolean).join('\n\n');
}

function serializeDataPart(part: vscode.LanguageModelDataPart): string {
  const mimeType = part.mimeType.toLowerCase();
  if (mimeType === USAGE_DATA_PART_MIME) {
    return '';
  }
  if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('javascript')) {
    return textDecoder.decode(part.data);
  }
  return `[binary data: ${part.mimeType}, ${part.data.byteLength} bytes]`;
}

function isImageMime(mimeType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(mimeType.toLowerCase());
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}