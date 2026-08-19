const DEFAULT_INTERNAL_BASE_URL = 'http://127.0.0.1:5199';

let installed = false;

function internalBaseUrl(): string {
  return (process.env.OPENCHATCUT_INTERNAL_BASE_URL
    || process.env.OPENCHATCUT_SERVER_BASE_URL
    || DEFAULT_INTERNAL_BASE_URL).replace(/\/+$/, '');
}

function resolveRelative(input: string): string {
  return input.startsWith('/') ? `${internalBaseUrl()}${input}` : input;
}

/**
 * Browser tools use same-origin fetch('/...'). External agent runs in Node, so
 * route those calls back through the already-authenticated local server.
 */
export function installExternalAgentServerFetch(): void {
  if (installed || typeof window !== 'undefined') return;
  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (!originalFetch) return;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') return originalFetch(resolveRelative(input), init);
    if (input instanceof URL) return originalFetch(new URL(resolveRelative(input.href)), init);
    return originalFetch(input, init);
  }) as typeof fetch;
  installed = true;
}
