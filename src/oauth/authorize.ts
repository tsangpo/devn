import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { platform } from '../platform';
import type { OAuthBinding } from '../types';
import { form, scope, OAuthError, type Metadata } from './protocol';
import { secureURL } from '../urls';
export type AuthMode = 'auto' | 'browser' | 'device';
const random = () => randomBytes(32).toString('base64url');

async function device(auth: OAuthBinding, metadata: Metadata, signal: AbortSignal) {
  const data = await form(metadata.device_authorization_endpoint, { client_id: auth.clientId, resource: auth.resource, scope }, signal);
  if (typeof data.device_code !== 'string' || !data.device_code || typeof data.user_code !== 'string' ||
    !/^[\w -]{1,128}$/.test(data.user_code) || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
    (data.interval !== undefined && (!Number.isFinite(data.interval) || data.interval <= 0))) throw new OAuthError('invalid_device_response');
  const uri = secureURL(data.verification_uri_complete || data.verification_uri);
  if (uri.origin !== new URL(auth.issuer).origin) throw new OAuthError('verification_origin');
  console.error(`Open ${uri.href}\nEnter code: ${data.user_code}`);
  let interval = data.interval ?? 5;
  const deadline = Date.now() + Math.min(data.expires_in, 1800) * 1000;
  while (Date.now() < deadline) {
    await delay(Math.min(interval * 1000, deadline - Date.now()), undefined, { signal });
    if (Date.now() >= deadline) break;
    try {
      return await form(metadata.token_endpoint, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: data.device_code, client_id: auth.clientId, resource: auth.resource }, signal);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      if (error.code === 'slow_down') interval += 5;
      else if (error.code !== 'authorization_pending') throw error;
    }
  }
  throw new OAuthError('expired_token');
}
class ListenError extends Error {}
async function browser(auth: OAuthBinding, metadata: Metadata, signal: AbortSignal) {
  const state = random(), verifier = random();
  let resolve!: (code: string) => void, reject!: (error: Error) => void;
  const result = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  let server;
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
      const url = new URL(req.url);
      if (req.method !== 'GET' || url.pathname !== '/callback') return new Response('Not found', { status: 404 });
      if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state ||
        url.searchParams.getAll('iss').length !== 1 || url.searchParams.get('iss') !== auth.issuer) return new Response('Invalid callback', { status: 400 });
      if (url.searchParams.has('error')) { reject(new OAuthError('access_denied')); return new Response('Authorization declined'); }
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.getAll('code').length !== 1) return new Response('Missing code', { status: 400 });
      resolve(code);
      return new Response('Signed in. You can close this window.', { headers: { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" } });
    } });
  } catch { throw new ListenError('Cannot listen on loopback.'); }
  const abort = () => reject(new OAuthError('cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => reject(new OAuthError('authorization_timeout')), 300000);
  try {
    const redirect = `http://127.0.0.1:${server.port}/callback`;
    const url = new URL(metadata.authorization_endpoint);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: auth.clientId, redirect_uri: redirect, scope, resource: auth.resource, state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })) url.searchParams.set(key, value);
    console.error(`Open this URL to sign in: ${url.href}`);
    void platform.openBrowser(url.href).catch(() => console.error('Browser could not be opened; use the link above.'));
    const code = await result;
    return await form(metadata.token_endpoint, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, client_id: auth.clientId, resource: auth.resource }, signal);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); server.stop(true); }
}
export async function authorize(auth: OAuthBinding, metadata: Metadata, mode: AuthMode) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  try {
    if (mode === 'device' || (mode === 'auto' && !platform.hasDesktop())) return await device(auth, metadata, controller.signal);
    try { return await browser(auth, metadata, controller.signal); }
    catch (error) { if (mode === 'auto' && error instanceof ListenError) return await device(auth, metadata, controller.signal); throw error; }
  } finally { process.off('SIGINT', abort); }
}
