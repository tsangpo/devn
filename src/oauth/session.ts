import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLock, configHome, privateDir, privateFile, readJson, writeJson } from '../files';
import { sameBinding, validSessionId, validateBinding } from './binding';
import type { OAuthBinding, SessionRef } from '../types';
import { discover, form, type Tokens } from './protocol';

const directory = () => path.join(configHome(), 'oauth');
function file(ref: SessionRef): string {
  if (!validSessionId(ref.id)) throw new Error('Invalid OAuth session ID.');
  return path.join(directory(), `${ref.id}.json`);
}
export const newSession = (auth: OAuthBinding): SessionRef => ({ id: randomUUID(), auth });
export function lockSession(ref: SessionRef) {
  file(ref);
  return acquireLock(path.join(configHome(), '.locks', `oauth-${ref.id}.lock`));
}
export class InvalidSession extends Error {
  constructor() { super('Invalid OAuth session file. Run devn profile add to re-authorize the profile.'); }
}
export function readSession(ref: SessionRef): Tokens | undefined {
  if (!fs.existsSync(file(ref))) return;
  privateFile(file(ref));
  let value;
  try { value = readJson(file(ref)); validateBinding(value?.auth); } catch { throw new InvalidSession(); }
  if (!value || value.version !== 2 || value.id !== ref.id || !sameBinding(ref.auth, value.auth) || typeof value.revision !== 'string') throw new InvalidSession();
  if (value.tokens === null) return;
  if (!value.tokens || !['access', 'refresh'].every(k => typeof value.tokens[k] === 'string' && value.tokens[k]) ||
    Object.keys(value.tokens).some(k => !['access', 'refresh', 'expires'].includes(k)) || !Number.isFinite(value.tokens.expires)) throw new InvalidSession();
  return value.tokens;
}
export function saveSession(ref: SessionRef, tokens: Tokens) {
  privateDir(directory());
  writeJson(file(ref), { version: 2, id: ref.id, auth: ref.auth, revision: randomUUID(), tokens });
}
export function deleteSession(ref: SessionRef) {
  privateDir(directory());
  writeJson(file(ref), { version: 2, id: ref.id, auth: ref.auth, revision: randomUUID(), tokens: null });
}
export function sessionRevision(ref: SessionRef): string | undefined {
  if (!fs.existsSync(file(ref))) return;
  privateFile(file(ref));
  return readJson(file(ref)).revision;
}
export async function revokeToken(auth: OAuthBinding, refresh: string) {
  const metadata = await discover(auth);
  await form(metadata.revocation_endpoint, { token: refresh, token_type_hint: 'refresh_token', client_id: auth.clientId });
}
// Caller holds this profile's session lock. A revision tombstone rejects late callbacks.
export async function retireSession(ref: SessionRef): Promise<void> {
  let confirmed = true;
  try {
    const current = readSession(ref);
    if (current) await revokeToken(ref.auth, current.refresh);
  } catch { confirmed = false; }
  finally { deleteSession(ref); }
  if (!confirmed) console.error('devn: Profile OAuth session cleared locally; remote revocation was not confirmed.');
}
export async function lockSessions(refs: (SessionRef | undefined)[]): Promise<() => void> {
  const unique = new Map(refs.filter((r): r is SessionRef => r !== undefined).map(r => [r.id, r]));
  const releases: (() => void)[] = [];
  const release = () => { while (releases.length) releases.pop()!(); };
  try {
    for (const id of [...unique.keys()].sort()) releases.push(await lockSession(unique.get(id)!));
    return release;
  } catch (error) { release(); throw error; }
}
