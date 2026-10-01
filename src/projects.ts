import fs from 'node:fs';
import path from 'node:path';
import type { Registration, Registry } from './registry';

export function findBinding(registry: Registry, cwd = process.cwd()): { id: string; dir: string } | undefined {
  let dir = fs.realpathSync.native(cwd);
  while (true) {
    if (Object.hasOwn(registry.projects, dir)) return { id: registry.projects[dir], dir };
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
  const binding = findBinding(registry);
  if (!binding) throw new Error('No project binding found. Run devn profile use in your project directory.');
  return getProfile(registry, binding.id);
}
