import path from 'node:path';
import { platform } from './platform';
import { acquireLock, atomicWrite, configHome, privateDir, privateFile, profileDir } from './files';
import { gatewayOrigins, validId, validateProfile, type Profile, type Registry, type Registration } from './registry';
import { downloadProfile, Unavailable } from './download';
import { purgeProfileData, scrubCredentials } from './profile-data';
import { secureURL } from './urls';

const configFile = () => `${configHome()}/config.toml`;
const cacheFile = (id: string) => `${profileDir(id)}/profile.json`;
export const safeId = (id: unknown): id is string => validId(id) && !['__proto__', 'constructor', 'prototype'].includes(id as string) && platform.validProfileName(id as string);

export function lockProfile(id: string): Promise<() => void> {
  if (!safeId(id)) throw new Error('Invalid profile name.');
  return acquireLock(`${configHome()}/.locks/${id}.lock`);
}

function validateRegistration(id: string, value: any): void {
  if (!safeId(id) || !value || typeof value !== 'object' ||
      Object.keys(value).some(k => !['url', 'key', 'origins'].includes(k)) ||
      typeof value.key !== 'string' || !value.key.trim() || /[\r\n\x00]/.test(value.key)) {
    throw new Error('Invalid profile registration. Use devn profile add.');
  }
  secureURL(value.url);
  if (value.origins !== undefined) {
    if (!value.origins || Object.keys(value.origins).sort().join(',') !== 'claude,codex') throw new Error('Invalid trusted gateway origins.');
    for (const origin of Object.values(value.origins)) {
      if (secureURL(origin).origin !== origin) throw new Error('Invalid trusted gateway origin.');
    }
  }
}

export async function loadRegistry(): Promise<Registry> {
  const file = Bun.file(configFile());
  if (!await file.exists()) return { profiles: [], projects: {} };
  privateFile(configFile());
  let config: any;
  try { config = Bun.TOML.parse(await file.text()); }
  catch { throw new Error('Invalid devn config.toml. Repair it before continuing.'); }
  if (config.version !== 1 || !config.profiles || typeof config.profiles !== 'object' ||
      Array.isArray(config.profiles) || Object.keys(config).some(k => !['version', 'profiles', 'projects'].includes(k))) {
    throw new Error('Invalid devn config.toml structure (supported version: 1).');
  }
  const projects = config.projects ?? {};
  if (!projects || typeof projects !== 'object' || Array.isArray(projects) ||
      !Object.entries(projects).every(([dir, id]) => path.isAbsolute(dir) && safeId(id))) {
    throw new Error('Invalid project bindings in devn config.toml. Use devn profile use.');
  }
  const profiles = Object.entries(config.profiles).map(([id, value]: [string, any]) => {
    validateRegistration(id, value);
    return { id, name: id, url: value.url, key: value.key, ...(value.origins ? { origins: value.origins } : {}) };
  });
  const identities = profiles.map(p => platform.profileIdentity(p.id));
  if (new Set(identities).size !== identities.length) throw new Error('Profile names refer to the same directory. Rename conflicting registrations.');
  const canonical: Record<string, string> = {};
  for (const [dir, id] of Object.entries(projects) as [string, string][]) {
    const key = platform.storedProjectPath(dir);
    if (Object.hasOwn(canonical, key) && canonical[key] !== id) throw new Error('Conflicting project bindings refer to the same directory.');
    canonical[key] = id;
  }
  return { profiles, projects: canonical };
}

function saveRegistry(registry: Registry): void {
  const entries = Object.fromEntries(registry.profiles.map(({ id, url, key, origins }) => [id, { url, key, ...(origins ? { origins } : {}) }]));
  atomicWrite(configFile(), Bun.TOML.stringify({ version: 1, profiles: entries, projects: registry.projects }) + '\n');
}

async function updateRegistry(change: (registry: Registry) => void): Promise<void> {
  const release = await acquireLock(`${configHome()}/.registry.lock`);
  try {
    const registry = await loadRegistry();
    change(registry);
    saveRegistry(registry);
  } finally { release(); }
}

export function bindProject(dir: string, id: string): Promise<void> {
  return updateRegistry(registry => {
    if (!registry.profiles.some(p => p.id === id)) throw new Error(`Unknown profile ${id}. Run devn profile list.`);
    registry.projects[platform.projectPath(dir)] = id;
  });
}

export function unbindProject(dir: string): Promise<void> {
  return updateRegistry(registry => {
    dir = platform.projectPath(dir);
    if (!(dir in registry.projects)) throw new Error(`No project binding for ${dir}.`);
    delete registry.projects[dir];
  });
}

export function assertTrusted(entry: Registration, profile: Profile): void {
  const origins = gatewayOrigins(profile);
  if (!entry.origins || entry.origins.codex !== origins.codex || entry.origins.claude !== origins.claude) {
    throw new Error(`Gateway origins are unapproved or changed for ${entry.id}. Run devn profile add to review and accept them.`);
  }
}

export async function cachedProfile(id: string): Promise<Profile> {
  const profile = validateProfile(await Bun.file(cacheFile(id)).json(), id);
  if (profile.example) throw new Error('Example profiles cannot connect.');
  return profile;
}

export async function addProfile(id: string, url: string, key: string, expected?: Registration,
  approve: (profile: Profile) => Promise<boolean> = async () => false): Promise<void> {
  validateRegistration(id, { url, key });
  const profile = await downloadProfile(url, id);
  if (!await approve(profile)) throw new Error('Gateway approval cancelled; profile was not changed.');
  const release = await lockProfile(id);
  try {
    const releaseRegistry = await acquireLock(`${configHome()}/.registry.lock`);
    try {
      const registry = await loadRegistry();
      if (registry.profiles.some(p => p.id !== id && platform.profileIdentity(p.id) === platform.profileIdentity(id))) {
        throw new Error('Profile name conflicts with an existing directory. Use its exact registered name.');
      }
      const current = registry.profiles.find(p => p.id === id);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Profile changed while adding it. Run devn profile add again.');
      privateDir(`${configHome()}/profiles`);
      privateDir(profileDir(id));
      const cache = Bun.file(cacheFile(id));
      const previous = await cache.exists() ? await cache.text() : undefined;
      const entry: Registration = { id, name: id, url, key, origins: gatewayOrigins(profile) };
      registry.profiles = [...registry.profiles.filter(p => p.id !== id), entry];
      atomicWrite(cacheFile(id), JSON.stringify(profile, null, 2) + '\n');
      try { saveRegistry(registry); }
      catch (error) {
        if (previous !== undefined) atomicWrite(cacheFile(id), previous);
        else await cache.delete();
        throw error;
      }
    } finally { releaseRegistry(); }
  } finally { release(); }
}

export async function refreshProfile(id: string): Promise<{ profile: Profile; key: string }> {
  const release = await lockProfile(id);
  try {
    const entry = (await loadRegistry()).profiles.find(p => p.id === id);
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
  const release = await lockProfile(id);
  try {
    const releaseRegistry = await acquireLock(`${configHome()}/.registry.lock`);
    try {
      const registry = await loadRegistry();
      if (registry.profiles.some(p => p.id !== id && platform.profileIdentity(p.id) === platform.profileIdentity(id))) throw new Error('Use the exact registered profile name.');
      if (!purge && !registry.profiles.some(p => p.id === id)) throw new Error(`Unknown profile ${id}.`);
      if (purge) purgeProfileData(id);
      else await scrubCredentials(id);
      registry.profiles = registry.profiles.filter(p => p.id !== id);
      saveRegistry(registry);
    } finally { releaseRegistry(); }
  } finally { release(); }
}
