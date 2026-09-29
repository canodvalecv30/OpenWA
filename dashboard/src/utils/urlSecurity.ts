const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Whether a hostname is a loopback/local address where plaintext http is acceptable. */
export function isLocalhostHost(hostname: string): boolean {
  return LOCALHOST_HOSTS.has(hostname.toLowerCase().replace(/^\[|\]$/g, ''));
}

/**
 * Warn (NOT throw) when a URL is `http://` and the host is not localhost. Sending API keys over
 * plaintext http to a non-local host exposes credentials on the wire; warning instead of refusing
 * keeps local dev and TLS-terminating-proxy setups working. Returns the original URL unchanged so
 * the caller can chain.
 */
export function warnIfInsecureHttpUrl(url: string, label: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' && !isLocalhostHost(parsed.hostname)) {
      console.warn(
        `[OpenWA] ${label} uses an insecure http:// URL (host: ${parsed.hostname}). ` +
          'API keys are sent in cleartext over http. Use https:// in production.',
      );
    }
  } catch {
    // Unparseable — the downstream fetch will produce a clear error; not our job to validate here.
  }
  return url;
}

/**
 * The origin the realtime socket dials: VITE_WS_URL when set, else the origin of VITE_API_URL (a
 * split-origin build serves the socket from the API, not from the dashboard's host), else the page's
 * own origin. Only the origin is taken from VITE_API_URL: socket.io reads a URL path as the namespace,
 * so a path there would turn '/events' into an unknown namespace the gateway rejects.
 */
export function resolveSocketUrl(wsUrl: string | undefined, apiUrl: string, pageOrigin: string): string {
  if (wsUrl) return wsUrl;
  if (!apiUrl) return pageOrigin;
  try {
    return new URL(apiUrl, pageOrigin).origin;
  } catch {
    return pageOrigin;
  }
}
