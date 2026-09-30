// Loopback HTTP supports local development; all remote services require TLS.
export function secureURL(value: unknown): URL {
  let url: URL;
  try {
    if (typeof value !== 'string') throw new Error();
    url = new URL(value);
  } catch { throw new Error('Expected an absolute HTTPS URL.'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error('URLs require HTTPS (HTTP is allowed only for loopback), without credentials or fragments.');
  }
  return url;
}

export function displayURL(value: string): string {
  const url = new URL(value);
  // Paths and queries may contain private routing details or signed tokens.
  return url.origin + (url.pathname === '/' ? '/' : '/[path]') + (url.search ? '?[redacted]' : '');
}
