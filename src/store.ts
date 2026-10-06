import path from 'node:path';
import fs from 'node:fs';
import { validateBinding, sameBinding, validSessionId } from './oauth/binding';
import type { SessionRef, OAuthCredentials } from './types';
import { lockSessions, readSession, retireSession, newSession, sessionRevision } from './oauth/session';
import { platform } from './platform';
import { acquireLock, atomicWrite, configHome, privateDir, privateFile, profileDir } from './files';
import { gatewayOrigins, validId, validateProfile } from './profile';
import type { Profile, LocalConfig, Tool } from './types';
import { downloadProfile, Unavailable } from './download';
import { generateConfig, scrubCredentials } from './config';
import { secureURL } from './urls';
import { clients, isTool } from './clients';

const configFile = () => `${configHome()}/config.toml`;
const cacheFile = (id: string) => `${profileDir(id)}/profile.json`;
export const safeId = (id: unknown): id is string => validId(id) && !['__proto__', 'constructor', 'prototype'].includes(id as string) && platform.validProfileName(id as string);

export function lockProfile(id: string): Promise<() => void> {
  if (!safeId(id)) throw new Error('Invalid profile name.');
  return acquireLock(`${configHome()}/.locks/${id}.lock`);
}

function validateLocalProfile(id: string, value: any): void {
  if (!safeId(id) || !value || typeof value !== 'object' ||
      Object.keys(value).some(k => !['url', 'key', 'origins', 'auth', 'sessionId'].includes(k)) ||
      typeof value.key !== 'string' || (!value.key.trim() && !value.auth) || /[\r\n\x00]/.test(value.key)) {
    throw new Error('Invalid profile registration. Use devn profile add.');
  }
  secureURL(value.url);
  if (value.auth !== undefined) {
    validateBinding(value.auth);
    if (!validSessionId(value.sessionId)) throw new Error('Invalid profile session ID.');
  }
  if (value.sessionId !== undefined && !value.auth) throw new Error('Invalid authentication registration.');
  if (value.origins !== undefined) {
    if (!value.origins || Array.isArray(value.origins) || typeof value.origins !== 'object' ||
        Object.keys(value.origins).some(key => !isTool(key)) ||
        clients.some(client => client.required && !Object.hasOwn(value.origins, client.id))) throw new Error('Invalid trusted gateway origins.');
    for (const origin of Object.values(value.origins)) {
      if (secureURL(origin).origin !== origin) throw new Error('Invalid trusted gateway origin.');
    }
  }
}

export function getProfile(config: LocalConfig, id: string): LocalConfig['profiles'][number] {
  const profile = config.profiles.find(p => p.id === id);
  if (!profile) throw new Error(`Unknown profile ${id}. Run devn profile list.`);
  return profile;
}

export async function loadConfig(): Promise<LocalConfig> {
  const file = Bun.file(configFile());
  if (!await file.exists()) return { profiles: [], projects: {} };
  privateFile(configFile());
  let config: any;
  try { config = Bun.TOML.parse(await file.text()); }
  catch { throw new Error('Invalid devn config.toml. Repair it before continuing.'); }
  if (config.version !== 3 || !config.profiles || typeof config.profiles !== 'object' ||
      Array.isArray(config.profiles) || Object.keys(config).some(k => !['version', 'profiles', 'projects'].includes(k))) {
    throw new Error('Invalid devn config.toml structure (supported version: 3; old formats are not supported).');
  }
  const projects = config.projects ?? {};
  if (!projects || typeof projects !== 'object' || Array.isArray(projects) ||
      !Object.entries(projects).every(([dir, id]) => path.isAbsolute(dir) && safeId(id))) {
    throw new Error('Invalid project bindings in devn config.toml. Use devn profile use.');
  }
  const profiles = Object.entries(config.profiles).map(([id, value]: [string, any]) => {
    validateLocalProfile(id, value);
    return { ...value, id } as LocalConfig['profiles'][number];
  });
  const identities = profiles.map(p => platform.profileIdentity(p.id));
  if (new Set(identities).size !== identities.length) throw new Error('Profile names refer to the same directory. Rename conflicting registrations.');
  const canonical: Record<string, string> = {};
  for (const [dir, id] of Object.entries(projects) as [string, string][]) {
    const key = platform.storedProjectPath(dir);
    if (Object.hasOwn(canonical, key) && canonical[key] !== id) throw new Error('Conflicting project bindings refer to the same directory.');
    canonical[key] = id;
  }
  const sessionIds = profiles.flatMap(p => p.sessionId ? [p.sessionId] : []);
  if (new Set(sessionIds).size !== sessionIds.length) throw new Error('OAuth sessions cannot be shared between profiles.');
  return { profiles, projects: canonical };
}

function saveConfig(config: LocalConfig): void {
  const entries = Object.fromEntries(config.profiles.map(({ id, ...entry }) => [id, entry]));
  atomicWrite(configFile(), Bun.TOML.stringify({ version: 3, profiles: entries, projects: config.projects }) + '\n');
}

export async function updateConfig(change: (config: LocalConfig) => void): Promise<void> {
  const release = await acquireLock(`${configHome()}/.registry.lock`);
  try {
    const config = await loadConfig();
    change(config);
    saveConfig(config);
  } finally { release(); }
}

export function bindProject(dir: string, id: string): Promise<void> {
  return updateConfig(config => {
    if (!config.profiles.some(p => p.id === id)) throw new Error(`Unknown profile ${id}. Run devn profile list.`);
    config.projects[platform.projectPath(dir)] = id;
  });
}

export function unbindProject(dir: string): Promise<void> {
  return updateConfig(config => {
    dir = platform.projectPath(dir);
    if (!(dir in config.projects)) throw new Error(`No project binding for ${dir}.`);
    delete config.projects[dir];
  });
}

export function assertTrusted(entry: LocalConfig['profiles'][number], profile: Profile): void {
  if (entry.auth && !sameBinding(entry.auth, profile.auth)) throw new Error('OAuth binding changed. Run devn profile add to review it.');
  const origins = gatewayOrigins(profile);
  if (!entry.origins || Object.entries(origins).some(([tool, origin]) => entry.origins![tool as keyof typeof origins] !== origin)) {
    throw new Error(`Gateway origins are unapproved or changed for ${entry.id}. Run devn profile add to review and accept them.`);
  }
}

export async function cachedProfile(id: string): Promise<Profile> {
  const profile = validateProfile(await Bun.file(cacheFile(id)).json(), id);
  if (profile.example) throw new Error('Example profiles cannot connect.');
  return profile;
}

export function profileSession(entry: LocalConfig['profiles'][number] | undefined): SessionRef | undefined {
  return entry?.auth && entry.sessionId ? { id: entry.sessionId, auth: entry.auth } : undefined;
}

// Session IDs belong to a single registration, never to an issuer/resource tuple.
async function retireUnusedSessions(refs: (SessionRef | undefined)[]): Promise<void> {
  const unique = new Map(refs.filter((r): r is SessionRef => r !== undefined).map(r => [r.id, r]));
  const config = await loadConfig();
  for (const [id, ref] of unique) {
    if (!config.profiles.some(p => p.sessionId === id)) await retireSession(ref);
  }
}

export async function addProfile(id: string, url: string, keyInput: string | ((profile: Profile, session?: SessionRef) => Promise<string | OAuthCredentials>), expected?: LocalConfig['profiles'][number],
  approve: (profile: Profile) => Promise<boolean> = async () => false): Promise<void> {
  if (!safeId(id)) throw new Error('Invalid profile name.');
  secureURL(url);
  await loadConfig();
  if (typeof keyInput === 'string') validateLocalProfile(id, { url, key: keyInput });
  const profile = await downloadProfile(url, id);
  if (!await approve(profile)) throw new Error('Gateway approval cancelled; profile was not changed.');
  const oldSession = profileSession(expected);
  const candidate = profile.auth ? (oldSession && sameBinding(oldSession.auth, profile.auth) ? oldSession : newSession(profile.auth)) : undefined;
  if (oldSession && candidate?.id !== oldSession.id) {
    const release = await lockSessions([oldSession]);
    try {
      const current = (await loadConfig()).profiles.find(p => p.id === id);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Profile changed while adding it. Try again.');
      await clearProfileCredentials(oldSession);
      await retireSession(oldSession);
    } finally { release(); }
  }
  // Authentication waits hold no locks. On failure, discard only sessions that
  // belong to this add attempt; other profiles remain untouched.
  let input: string | OAuthCredentials;
  try { input = typeof keyInput === 'function' ? await keyInput(profile, candidate) : keyInput; }
  catch (error) {
    const release = await lockSessions([candidate]);
    try { await retireUnusedSessions([candidate]); } finally { release(); }
    throw error;
  }
  const { revision, ...credentials } = typeof input === 'string' ? { key: input, revision: undefined } : input;
  const newRef = 'auth' in credentials ? candidate : undefined;
  const affected = [oldSession, candidate];
  const sessionRelease = await lockSessions(affected);
  try {
    validateLocalProfile(id, { url, ...credentials });
    if ('auth' in credentials && (!newRef || credentials.sessionId !== newRef.id || !sameBinding(credentials.auth, newRef.auth))) throw new Error('Authentication does not match this profile session.');
    if (newRef && (!readSession(newRef) || sessionRevision(newRef) !== revision)) throw new Error('OAuth session changed while adding profile. Try again.');
    const release = await lockProfile(id);
    try {
      const releaseConfig = await acquireLock(`${configHome()}/.registry.lock`);
      try {
        const config = await loadConfig();
        if (config.profiles.some(p => p.id !== id && platform.profileIdentity(p.id) === platform.profileIdentity(id))) {
          throw new Error('Profile name conflicts with an existing directory. Use its exact registered name.');
        }
        const current = config.profiles.find(p => p.id === id);
        // An account switch may clear this registration while authentication runs.
        const clearedDuringLogin = current?.auth && current.key === '' &&
          JSON.stringify({ ...current, key: '' }) ===
          JSON.stringify(expected && { ...expected, key: '' });
        if (JSON.stringify(current) !== JSON.stringify(expected) && !clearedDuringLogin) {
          throw new Error('Profile changed while adding it. Run devn profile add again.');
        }
        privateDir(`${configHome()}/profiles`);
        privateDir(profileDir(id));
        const cache = Bun.file(cacheFile(id));
        const previous = await cache.exists() ? await cache.text() : undefined;
        const entry: LocalConfig['profiles'][number] = { id, url, ...credentials, origins: gatewayOrigins(profile) };
        await scrubCredentials(id, true);
        config.profiles = [...config.profiles.filter(p => p.id !== id), entry];
        atomicWrite(cacheFile(id), JSON.stringify(profile, null, 2) + '\n');
        try { saveConfig(config); }
        catch (error) {
          if (previous !== undefined) atomicWrite(cacheFile(id), previous);
          else await cache.delete();
          throw error;
        }
      } finally { releaseConfig(); }
    } finally { release(); }
  } finally {
    try { await retireUnusedSessions(affected); } finally { sessionRelease(); }
  }
}

export async function refreshProfile(id: string): Promise<{ profile: Profile; key: string }> {
  const release = await lockProfile(id);
  try {
    const entry = (await loadConfig()).profiles.find(p => p.id === id);
    if (!entry) throw new Error(`Unknown profile ${id}. Run devn profile add.`);
    let profile: Profile;
    try {
      profile = await downloadProfile(entry.url, id);
    } catch (error) {
      if (!(error instanceof Unavailable)) throw error;
      try { profile = await cachedProfile(id); }
      catch { throw new Error(`Profile ${id} is unavailable and has no valid cache.`); }
      assertTrusted(entry, profile);
      console.error(`devn: ${error.message} Using cached profile ${id}.`);
      return { profile, key: entry.key };
    }
    assertTrusted(entry, profile);
    privateDir(`${configHome()}/profiles`);
    privateDir(profileDir(id));
    atomicWrite(cacheFile(id), JSON.stringify(profile, null, 2) + '\n');
    return { profile, key: entry.key };
  } finally { release(); }
}

export async function removeProfile(id: string, purge = false): Promise<void> {
  if (!safeId(id)) throw new Error('Invalid profile name.');
  const snapshot = (await loadConfig()).profiles.find(p => p.id === id);
  const sessionRelease = await lockSessions([profileSession(snapshot)]);
  try {
    const release = await lockProfile(id);
    try {
      const releaseConfig = await acquireLock(`${configHome()}/.registry.lock`);
      try {
        const config = await loadConfig();
        if (config.profiles.some(p => p.id !== id && platform.profileIdentity(p.id) === platform.profileIdentity(id))) throw new Error('Use the exact registered profile name.');
        const current = config.profiles.find(p => p.id === id);
        if (snapshot?.sessionId !== current?.sessionId || !sameBinding(snapshot?.auth, current?.auth)) throw new Error('Profile changed while removing it. Try again.');
        if (!purge && !current) throw new Error(`Unknown profile ${id}.`);
        if (purge) fs.rmSync(profileDir(id), { recursive: true, force: true });
        else await scrubCredentials(id);
        config.profiles = config.profiles.filter(p => p.id !== id);
        saveConfig(config);
      } finally { releaseConfig(); }
    } finally { release(); }
    // Do not keep a profile or config lock across network revocation.
    await retireUnusedSessions([profileSession(snapshot)]);
  } finally { sessionRelease(); }
}


export async function prepareConfig(profile: Profile, tool: Tool, apiKey: string): Promise<{ file: string; model?: string }> {
  const root = profileDir(profile.id);
  privateDir(root);
  const release = await lockProfile(profile.id);
  try {
    const entry = (await loadConfig()).profiles.find(p => p.id === profile.id);
    if (!entry || entry.key !== apiKey) throw new Error('Profile changed before launch. Try again.');
    assertTrusted(entry, profile);
    return await generateConfig(profile, tool, apiKey);
  } finally { release(); }
}

// Caller holds the owning session lock; these operations acquire profile/config locks.
export async function clearProfileCredentials(ref: SessionRef) {
  const entry = (await loadConfig()).profiles.find(p => p.sessionId === ref.id);
  if (!entry) return;
  const release = await lockProfile(entry.id);
  try {
    let matched = false;
    await updateConfig(config => {
      const p = config.profiles.find(p => p.id === entry.id);
      if (p?.sessionId === ref.id) { p.key = ''; matched = true; }
    });
    if (matched) await scrubCredentials(entry.id, true);
  } finally { release(); }
}

export async function updateProfileCredentials(entry: LocalConfig['profiles'][number], value: { key: string }) {
  const release = await lockProfile(entry.id);
  try {
    // Scrub before publishing a rotated key; failed disk cleanup must not commit it.
    if (entry.key !== value.key) await scrubCredentials(entry.id, true);
    await updateConfig(config => {
      const p = config.profiles.find(p => p.id === entry.id);
      if (!p || p.sessionId !== entry.sessionId || p.url !== entry.url || !sameBinding(p.auth, entry.auth)) throw new Error('Profile changed during synchronization. Try again.');
      p.key = value.key;
    });
  } finally { release(); }
}
