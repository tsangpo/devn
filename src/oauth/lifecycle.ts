import type { SessionRef, OAuthCredentials } from '../types';
import { loadConfig, clearProfileCredentials, updateProfileCredentials, profileSession } from '../store';
import { sameBinding } from './binding';
import { lockSession, readSession, saveSession, deleteSession, sessionRevision, InvalidSession, revokeToken } from './session';
import { discover, form, tokens, request, OAuthError, type Tokens } from './protocol';
import { authorize, type AuthMode } from './authorize';

function invalidatesCredentials(error: OAuthError): boolean {
  return error.code === 'account_disabled' ||
    (error.context === 'refresh' && error.code === 'invalid_grant') ||
    (error.context === 'resource' && [401, 403, 404].includes(error.status));
}

// Lock order: this profile's session -> profile -> config. Interactive waits hold no locks.
async function invalidate(ref: SessionRef, error: unknown) {
  if (error instanceof InvalidSession || (error instanceof OAuthError && invalidatesCredentials(error))) {
    // No other profile can own this session, even when its auth binding is identical.
    if (error instanceof InvalidSession || ['invalid_grant', 'account_disabled'].includes(error.code) || error.status === 401) deleteSession(ref);
    await clearProfileCredentials(ref);
  }
}
async function refresh(ref: SessionRef, current: Tokens): Promise<Tokens> {
  const auth = ref.auth, metadata = await discover(auth);
  const body = { grant_type: 'refresh_token', client_id: auth.clientId, refresh_token: current.refresh, resource: auth.resource };
  let response;
  try { response = await form(metadata.token_endpoint, body, undefined, 'refresh'); }
  catch (error) {
    if (!(error instanceof OAuthError) || !error.unavailable) throw error;
    response = await form(metadata.token_endpoint, body, undefined, 'refresh'); // Recover lost rotation response within 30 seconds.
  }
  const result = tokens(response, current.refresh);
  saveSession(ref, result); // Persist rotating refresh before another request can fail.
  return result;
}
async function keyRequest(ref: SessionRef, access: string, ensure: boolean): Promise<{ key: string }> {
  const headers = { Authorization: `Bearer ${access}` };
  let value;
  try { value = await request(ref.auth.resource, { headers }, undefined, 'resource'); }
  catch (error) {
    if (!ensure || !(error instanceof OAuthError) || error.status !== 404 || error.code !== 'key_missing') throw error;
    value = await request(ref.auth.resource, { method: 'POST', headers }, undefined, 'resource');
  }
  // The resource URL is opaque; optional response fields are ignored.
  if (typeof value?.key !== 'string' || !value.key.trim() || /[\r\n\x00]/.test(value.key)) throw new OAuthError('invalid_key_response');
  return { key: value.key };
}
async function synchronizedKey(ref: SessionRef, current: Tokens, ensure: boolean) {
  let refreshed = false;
  if (current.expires <= Date.now() + 30000) { current = await refresh(ref, current); refreshed = true; }
  try { return await keyRequest(ref, current.access, ensure); }
  catch (error) {
    if (!(error instanceof OAuthError) || error.status !== 401 || refreshed) throw error;
    current = await refresh(ref, current);
    return keyRequest(ref, current.access, ensure);
  }
}

export async function loginCredentials(ref: SessionRef, mode: AuthMode): Promise<OAuthCredentials> {
  let revision: string | undefined;
  const unlock = await lockSession(ref);
  try {
    try {
      const current = readSession(ref);
      if (current) return { ...await synchronizedKey(ref, current, true), auth: ref.auth, sessionId: ref.id, revision: sessionRevision(ref)! };
    } catch (error) {
      await invalidate(ref, error);
      if (!(error instanceof InvalidSession) && (!(error instanceof OAuthError) ||
        !(invalidatesCredentials(error) && (error.code === 'invalid_grant' || error.status === 401)))) throw error;
    }
    await clearProfileCredentials(ref);
    deleteSession(ref); // Mark the new authorization attempt before releasing the lock.
    revision = sessionRevision(ref);
  } finally { unlock(); }
  let fresh: Tokens;
  try {
    const metadata = await discover(ref.auth);
    fresh = tokens(await authorize(ref.auth, metadata, mode));
  } catch (error) {
    const release = await lockSession(ref);
    try { if (sessionRevision(ref) === revision) await invalidate(ref, error); }
    finally { release(); }
    throw error;
  }
  const release = await lockSession(ref);
  try {
    if (sessionRevision(ref) !== revision) throw new Error('OAuth session changed while waiting for authorization. Re-add the profile.');
    const value = await keyRequest(ref, fresh.access, true);
    saveSession(ref, fresh);
    return { ...value, auth: ref.auth, sessionId: ref.id, revision: sessionRevision(ref)! };
  } catch (error) {
    // This newly issued grant was never registered. Do not leave it in a local file.
    try { await revokeToken(ref.auth, fresh.refresh); }
    catch { console.error('devn: Authorization was not saved; remote revocation was not confirmed.'); }
    await invalidate(ref, error);
    throw error;
  } finally { release(); }
}

export async function syncCredentials(id: string): Promise<string> {
  let entry = (await loadConfig()).profiles.find(p => p.id === id);
  if (!entry) throw new Error('Unknown profile.');
  const ref = profileSession(entry);
  if (!ref) return entry.key;
  const release = await lockSession(ref);
  try {
    entry = (await loadConfig()).profiles.find(p => p.id === id);
    if (!entry || entry.sessionId !== ref.id || !sameBinding(entry.auth, ref.auth)) throw new Error('Profile changed. Try again.');
    let current: Tokens | undefined;
    try {
      current = readSession(ref); // Parsing failures must follow the same invalidation path.
      if (!current) { await clearProfileCredentials(ref); throw new Error(`Not logged in. Run devn profile add and re-add profile ${id}.`); }
      const value = await synchronizedKey(ref, current, false);
      await updateProfileCredentials(entry, value);
      return value.key;
    } catch (error) {
      await invalidate(ref, error);
      if (error instanceof OAuthError && error.unavailable && !invalidatesCredentials(error) && current && entry.key) {
        console.error('devn: OAuth service unavailable; using this profile\'s cached key for the current session.');
        return entry.key;
      }
      if (error instanceof InvalidSession || (error instanceof OAuthError && invalidatesCredentials(error))) throw new Error(`${error.message} Run devn profile add and re-add profile ${id}.`);
      throw error;
    }
  } finally { release(); }
}
