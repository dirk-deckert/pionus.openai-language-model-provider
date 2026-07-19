import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { getProviderConfig } from './config.js';

export const API_KEY_SECRET = 'pionus.codex.apiKey';
const DEFAULT_USER_AGENT = 'pionus.openai-language-model-provider/0.0.1 VSCode-Extension';

export interface ApiCredentials {
  apiKey: string;
  headers: Record<string, string>;
  source: 'secretStorage' | 'codexAuth';
  omitMaxOutputTokens: boolean;
}

export async function getApiCredentials(context: vscode.ExtensionContext): Promise<ApiCredentials | undefined> {
  const config = getProviderConfig();
  if (config.credentialsSource === 'secretStorage') {
    return readSecretStorageCredentials(context);
  }
  if (config.credentialsSource === 'codexAuth') {
    return readCodexAuthCredentials();
  }

  return await readCodexAuthCredentials() ?? await readSecretStorageCredentials(context);
}

export async function setApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  await context.secrets.store(API_KEY_SECRET, apiKey);
}

export async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(API_KEY_SECRET);
}

async function readCodexAuthCredentials(): Promise<ApiCredentials | undefined> {
  try {
    const raw = await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8');
    const auth = JSON.parse(raw) as {
      OPENAI_API_KEY?: unknown;
      tokens?: {
        access_token?: unknown;
        account_id?: unknown;
      };
    };

    if (typeof auth.tokens?.access_token === 'string' && auth.tokens.access_token.trim()) {
      const headers: Record<string, string> = { 'User-Agent': DEFAULT_USER_AGENT };
      if (typeof auth.tokens.account_id === 'string' && auth.tokens.account_id.trim()) {
        headers['ChatGPT-Account-ID'] = auth.tokens.account_id.trim();
      }
      return {
        apiKey: auth.tokens.access_token.trim(),
        headers,
        source: 'codexAuth',
        omitMaxOutputTokens: true
      };
    }

    if (typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.trim()) {
      return {
        apiKey: auth.OPENAI_API_KEY.trim(),
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
        source: 'codexAuth',
        omitMaxOutputTokens: false
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function readSecretStorageCredentials(context: vscode.ExtensionContext): Promise<ApiCredentials | undefined> {
  const stored = await context.secrets.get(API_KEY_SECRET);
  if (!stored?.trim()) {
    return undefined;
  }

  return {
    apiKey: stored.trim(),
    headers: { 'User-Agent': DEFAULT_USER_AGENT },
    source: 'secretStorage',
    omitMaxOutputTokens: false
  };
}
