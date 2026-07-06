export function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+((responses)|(chat\/completions)|(completions))\/?$/i, '').replace(/\/+$/, '');
}