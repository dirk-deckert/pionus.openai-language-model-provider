import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import type { CredentialsSource } from './config.js';
import { normalizeBaseURL } from './urlUtils.js';

const LEGACY_API_KEY_SECRET = 'pionus.codex.apiKey';
const CHATGPT_API_KEY_SECRET = 'pionus.credentials.chatgpt';
const OPENAI_API_KEY_SECRET = 'pionus.credentials.openai';
const CUSTOM_API_KEY_PREFIX = 'pionus.credentials.endpoint.';
const DEFAULT_USER_AGENT = 'pionus.openai-language-model-provider/0.1.0 VSCode-Extension';

export interface ApiCredentials {
  apiKey: string;
  headers: Record<string, string>;
  source: 'secretStorage' | 'codexAuth';
  omitMaxOutputTokens: boolean;
}

export interface CodexAuthFile {
  OPENAI_API_KEY?: unknown;
  tokens?: {
    access_token?: unknown;
    account_id?: unknown;
  };
}

export interface CredentialTarget {
  kind: 'chatgpt' | 'openai' | 'custom';
  baseURL: string;
  label: string;
}

export function classifyCredentialTarget(baseURL: string): CredentialTarget {
  const normalized = normalizeBaseURL(baseURL);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`Invalid OpenAI endpoint URL: ${baseURL}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`OpenAI credential endpoints must use HTTPS: ${url.href}`);
  }
  if (url.username || url.password) {
    throw new Error('OpenAI credential endpoints must not contain embedded user information.');
  }

  const standardPort = url.port === '' || url.port === '443';
  if (standardPort && url.hostname === 'chatgpt.com' && url.pathname === '/backend-api/codex') {
    return { kind: 'chatgpt', baseURL: normalized, label: 'ChatGPT Codex' };
  }
  if (standardPort && url.hostname === 'api.openai.com' && url.pathname === '/v1') {
    return { kind: 'openai', baseURL: normalized, label: 'OpenAI API' };
  }
  return { kind: 'custom', baseURL: normalized, label: url.host };
}

export function getCredentialSecretKey(target: CredentialTarget): string {
  if (target.kind === 'chatgpt') {
    return CHATGPT_API_KEY_SECRET;
  }
  if (target.kind === 'openai') {
    return OPENAI_API_KEY_SECRET;
  }
  return `${CUSTOM_API_KEY_PREFIX}${createHash('sha256').update(target.baseURL).digest('hex')}`;
}

export async function getApiCredentials(
  context: vscode.ExtensionContext,
  baseURL: string,
  credentialsSource: CredentialsSource
): Promise<ApiCredentials | undefined> {
  const target = classifyCredentialTarget(baseURL);
  if (credentialsSource === 'secretStorage') {
    return readSecretStorageCredentials(context, target);
  }
  if (credentialsSource === 'codexAuth') {
    return readCodexAuthCredentials(target);
  }

  return await readCodexAuthCredentials(target) ?? await readSecretStorageCredentials(context, target);
}

export async function setApiKey(context: vscode.ExtensionContext, baseURL: string, apiKey: string): Promise<CredentialTarget> {
  const target = classifyCredentialTarget(baseURL);
  await context.secrets.store(getCredentialSecretKey(target), apiKey);
  return target;
}

export async function clearApiKey(context: vscode.ExtensionContext, baseURL: string): Promise<CredentialTarget> {
  const target = classifyCredentialTarget(baseURL);
  await context.secrets.delete(getCredentialSecretKey(target));
  if (target.kind !== 'custom') {
    await context.secrets.delete(LEGACY_API_KEY_SECRET);
  }
  return target;
}

export function selectCodexAuthCredentials(auth: CodexAuthFile, target: CredentialTarget): ApiCredentials | undefined {
  if (target.kind === 'chatgpt' && typeof auth.tokens?.access_token === 'string' && auth.tokens.access_token.trim()) {
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

  if (target.kind === 'openai' && typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.trim()) {
    return {
      apiKey: auth.OPENAI_API_KEY.trim(),
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      source: 'codexAuth',
      omitMaxOutputTokens: false
    };
  }
  return undefined;
}

async function readCodexAuthCredentials(target: CredentialTarget): Promise<ApiCredentials | undefined> {
  if (target.kind === 'custom') {
    return undefined;
  }
  try {
    const raw = await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8');
    return selectCodexAuthCredentials(JSON.parse(raw) as CodexAuthFile, target);
  } catch {
    return undefined;
  }
}

async function readSecretStorageCredentials(context: vscode.ExtensionContext, target: CredentialTarget): Promise<ApiCredentials | undefined> {
  const targetKey = getCredentialSecretKey(target);
  let stored = await context.secrets.get(targetKey);
  if (!stored?.trim() && target.kind !== 'custom') {
    stored = await context.secrets.get(LEGACY_API_KEY_SECRET);
    if (stored?.trim()) {
      await context.secrets.store(targetKey, stored.trim());
    }
  }
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
