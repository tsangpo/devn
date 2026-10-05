import type { OAuthBinding } from '../types';
import { secureURL } from '../urls';

export const scope = 'bifrost:key:read bifrost:key:ensure offline_access';
const errorCodes = new Set(['invalid_request', 'unauthorized_client', 'access_denied', 'unsupported_response_type',
  'invalid_scope', 'server_error', 'temporarily_unavailable', 'invalid_client', 'invalid_grant', 'unsupported_grant_type',
  'authorization_pending', 'slow_down', 'expired_token', 'invalid_token', 'insufficient_scope', 'account_disabled', 'key_missing']);
type RequestContext = 'other' | 'resource' | 'refresh';
export class OAuthError extends Error {
  constructor(public code: string, public status = 0, public context: RequestContext = 'other') { super(`OAuth request failed (${code}).`); }
  get unavailable() { return this.code === 'network' || this.status >= 500; }
}
export async function request(url: string, init: RequestInit = {}, signal?: AbortSignal, context: RequestContext = 'other'): Promise<any> {
  const failure = (code: string, status = 0) => new OAuthError(code, status, context);
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
  } catch { if (signal?.aborted) throw failure('cancelled'); throw failure('network'); }
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw failure('redirect_refused'); }
  // Never reflect error bodies or tokens into terminal output.
  let body: any;
  const reader = response.body?.getReader();
  let text = '', size = 0;
  const decoder = new TextDecoder();
  if (reader) {
    try {
      while (true) {
        let part: ReadableStreamReadResult<Uint8Array>;
        try { part = await reader.read(); }
        catch { throw failure(signal?.aborted ? 'cancelled' : 'network'); }
        if (part.done) break;
        size += part.value.length;
        if (size > 1048576) throw failure('response_too_large', response.status);
        text += decoder.decode(part.value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  try { body = text ? JSON.parse(text + decoder.decode()) : {}; }
  catch { throw failure('invalid_response', response.status); }
  if (!response.ok) throw failure(errorCodes.has(body?.error) ? body.error : 'http_error', response.status);
  return body;
}
export type Metadata = { authorization_endpoint: string; token_endpoint: string; device_authorization_endpoint: string; revocation_endpoint: string };
export async function discover(auth: OAuthBinding, signal?: AbortSignal): Promise<Metadata> {
  const issuer = new URL(auth.issuer);
  const value = await request(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname === '/' ? '' : issuer.pathname}`, {}, signal);
  if (value.issuer !== auth.issuer) throw new OAuthError('issuer_mismatch');
  for (const field of ['authorization_endpoint', 'token_endpoint', 'device_authorization_endpoint', 'revocation_endpoint']) {
    if (secureURL(value[field]).origin !== issuer.origin) throw new OAuthError('endpoint_origin');
  }
  if (!value.code_challenge_methods_supported?.includes('S256')) throw new OAuthError('pkce_unsupported');
  return value;
}
export function form(url: string, values: Record<string, string>, signal?: AbortSignal, context: RequestContext = 'other') {
  return request(url, { method: 'POST', body: new URLSearchParams(values) }, signal, context);
}
export type Tokens = { access: string; refresh: string; expires: number; subject: string };
export function tokens(value: any, previousRefresh?: string): Omit<Tokens, 'subject'> {
  const refresh = value?.refresh_token === undefined ? previousRefresh : value.refresh_token;
  if (typeof value?.access_token !== 'string' || !value.access_token || /\s/.test(value.access_token) ||
    typeof refresh !== 'string' || !refresh || /\s/.test(refresh) ||
    typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer' ||
    !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new OAuthError('invalid_token_response');
  return { access: value.access_token, refresh, expires: Date.now() + value.expires_in * 1000 };
}
