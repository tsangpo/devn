import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './files';
import { validId, type Registration, type Registry } from './registry';

export function declaration(file: string): string {
  const value = readJson(file);
  if (!value || value.version !== 1 || !validId(value.profile) || Object.keys(value).some(k => !['version', 'profile'].includes(k))) {
    throw new Error(`Invalid project declaration: ${file}. Expected {"version":1,"profile":"name"}.`);
  }
  return value.profile;
}
export function findBinding(cwd = process.cwd()): { id: string; file: string } | undefined {
  let dir = fs.realpathSync(cwd);
  while (true) {
    const file = path.join(dir, '.devn.json');
    if (fs.existsSync(file)) return { id: declaration(file), file };
    const parent = path.dirname(dir);
    if (dir === parent) return undefined;
    dir = parent;
  }
}
export function getProfile(registry: Registry, id: string): Registration {
  const profile = registry.profiles.find(p => p.id === id);
  if (!profile) throw new Error(`Unknown profile ${id}. Run devn profile list.`);
  return profile;
}
export function requireProfile(registry: Registry): Registration {
  const binding = findBinding();
  if (!binding) throw new Error('No .devn.json found. Run devn profile use in your project directory.');
  return getProfile(registry, binding.id);
}
export function bind(id: string): void {
  const file = path.join(process.cwd(), '.devn.json');
  if (fs.existsSync(file)) declaration(file);
  writeJson(file, { version: 1, profile: id }, 0o644);
}
