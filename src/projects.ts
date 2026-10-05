import { getProfile } from './store';
import { platform } from './platform';
import path from 'node:path';
import type { LocalConfig } from './types';

export function findBinding(config: LocalConfig, cwd = process.cwd()): { id: string; dir: string } | undefined {
  let dir = platform.projectPath(cwd);
  while (true) {
    if (Object.hasOwn(config.projects, dir)) return { id: config.projects[dir], dir };
    const parent = path.dirname(dir);
    if (dir === parent) return undefined;
    dir = parent;
  }
}
export function requireProfile(config: LocalConfig): LocalConfig['profiles'][number] {
  const binding = findBinding(config);
  if (!binding) throw new Error('No project binding found. Run devn profile use in your project directory.');
  return getProfile(config, binding.id);
}
