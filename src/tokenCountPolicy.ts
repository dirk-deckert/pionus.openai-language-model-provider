import { ResponsesTransportError } from './responsesClient.js';
import { normalizeBaseURL } from './urlUtils.js';

export const INPUT_TOKEN_SUPPORT_TTL_MS = 10 * 60 * 1000;

export type InputTokenEndpointSupport = 'supported' | 'unsupported';

interface SupportEntry {
  support: InputTokenEndpointSupport;
  expiresAt: number;
}

export class InputTokenEndpointSupportCache {
  private readonly entries = new Map<string, SupportEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = INPUT_TOKEN_SUPPORT_TTL_MS
  ) {}

  canAttempt(baseURL: string): boolean {
    return this.get(baseURL) !== 'unsupported';
  }

  markSupported(baseURL: string): void {
    this.set(baseURL, 'supported');
  }

  markUnsupported(baseURL: string): void {
    this.set(baseURL, 'unsupported');
  }

  recordFailure(baseURL: string, error: unknown): boolean {
    if (!isDefinitivelyUnsupportedInputTokenEndpoint(error)) {
      return false;
    }
    this.markUnsupported(baseURL);
    return true;
  }

  get(baseURL: string): InputTokenEndpointSupport | undefined {
    const key = normalizeBaseURL(baseURL);
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.support;
  }

  private set(baseURL: string, support: InputTokenEndpointSupport): void {
    this.entries.set(normalizeBaseURL(baseURL), {
      support,
      expiresAt: this.now() + this.ttlMs
    });
  }
}

export function isDefinitivelyUnsupportedInputTokenEndpoint(error: unknown): boolean {
  if (!(error instanceof ResponsesTransportError)) {
    return false;
  }
  if (error.status === 405 || error.status === 501) {
    return true;
  }
  return error.status === 404 && error.kind !== 'notFound';
}
