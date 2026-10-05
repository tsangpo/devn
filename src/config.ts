import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, privateDir, privateFile, profileDir, readJson, writeJson } from './files';
import { endpoint } from './profile';
import type { Profile, Tool } from './types';
import { clients, getClient } from './clients';
import type { ConfigData as Data } from './clients/types';

type KeyPath = string[];
const isObject = (value: any): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);

function paths(value: Data, replacePaths: string[], prefix: string[] = []): KeyPath[] {
  return Object.entries(value).flatMap(([key, item]) => {
    const next = [...prefix, key];
    // The entire provider is owned, so obsolete auth methods cannot survive a merge.
    if (replacePaths.includes(next.join('.'))) return [next];
    return isObject(item) && Object.keys(item).length ? paths(item, replacePaths, next) : [next];
  });
}
function deleteAt(value: Data, keys: KeyPath): void {
  if (!keys.length || keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) return;
  let cursor = value;
  for (const key of keys.slice(0, -1)) {
    if (!isObject(cursor[key])) return;
    cursor = cursor[key];
  }
  delete cursor[keys.at(-1)!];
}
function merge(existing: Data, managed: Data): Data {
  const result = structuredClone(existing);
  for (const [key, value] of Object.entries(managed)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe configuration key.');
    result[key] = isObject(value) && isObject(result[key]) ? merge(result[key], value) : value;
  }
  return result;
}

function readConfig(file: string, tool: Tool): Data {
  if (!fs.existsSync(file)) return {};
  privateFile(file);
  try {
    const value = getClient(tool).config.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(value)) throw new Error();
    return value;
  } catch {
    // Never include parser exceptions: they can quote the embedded API key.
    throw new Error(`Invalid ${tool} configuration at ${file}. Repair it before launching; no files were overwritten.`);
  }
}

// Caller holds the profile lock and has rechecked the approved binding and key.
export async function generateConfig(profile: Profile, tool: Tool, apiKey: string): Promise<{ file: string; model?: string }> {
  const root = profileDir(profile.id);
  privateDir(root);
  const client = getClient(tool);
  for (const entry of clients) if (entry.required) privateDir(path.join(root, entry.id));
  const dir = path.join(root, tool);
  privateDir(dir);
  client.config.checkFiles?.(dir);
  const file = path.join(dir, client.config.filename);
  const existing = readConfig(file, tool);
  const { ids, defaultModel } = client.models(profile);
  const model = ids
    ? (ids.includes(existing.model) ? existing.model : defaultModel)
    : undefined;
  if (ids && existing.model && model !== existing.model) console.error(`devn: saved ${tool} model is no longer listed; using ${model}.`);
  const { managed, files = [] } = client.config.build({ profile, dir, endpoint: endpoint(profile, tool), apiKey, existing, model });
  const manifest = path.join(dir, '.devn-managed.json');
  const prior = fs.existsSync(manifest) ? readJson(manifest) : { paths: [] };
  if (!Array.isArray(prior.paths) || !prior.paths.every((p: any) => Array.isArray(p) && p.every((k: any) => typeof k === 'string'))) {
    throw new Error(`Invalid ownership metadata at ${manifest}.`);
  }
  const ownedPaths = paths(managed, client.config.replacePaths);
  for (const keyPath of [...prior.paths, ...ownedPaths]) {
    if (!ids && keyPath.length === 1 && keyPath[0] === 'model') continue;
    deleteAt(existing, keyPath);
  }
  const output = merge(existing, managed);
  let serialized: string;
  try { serialized = client.config.serialize(output) + '\n'; }
  catch { throw new Error(`Cannot serialize ${tool} configuration; no configuration was written.`); }
  for (const extra of files) {
    const target = path.join(dir, extra.name);
    if (!extra.ifMissing || !fs.existsSync(target)) writeJson(target, extra.data);
  }
  atomicWrite(file, serialized);
  writeJson(manifest, { version: 1, paths: ownedPaths });
  return { file, model };
}

// Only scrub the credentials devn writes. Histories and personal settings stay intact.
export async function scrubCredentials(id: string, invalidate = false): Promise<void> {
  const updates: { file: string; content: string }[] = [];
  for (const client of clients) {
    const tool = client.id;
    const file = path.join(profileDir(id), tool, client.config.filename);
    if (!await Bun.file(file).exists()) continue;
    privateFile(file);
    try {
      const text = await Bun.file(file).text();
      const config: any = client.config.parse(text);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
      client.config.scrub(config);
      updates.push({ file, content: client.config.serialize(config) });
    } catch {
      if (!invalidate) throw new Error(`Cannot safely remove credentials from ${tool} configuration. Repair it or use --purge.`);
      // An invalidated or replaced credential must not survive in a malformed generated config.
      // Histories remain separate; do not create a backup containing the secret.
      fs.rmSync(file);
      console.error(`devn: Removed malformed ${tool} configuration while replacing or clearing credentials; history retained.`);
    }
  }
  for (const update of updates) atomicWrite(update.file, update.content + '\n');
}
