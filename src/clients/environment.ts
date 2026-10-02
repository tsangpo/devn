import path from 'node:path';
import type { Environment } from '../platform/types';

// Both launchers historically expose these two private homes. Keep that contract
// when invoked tools start one another; OpenCode uses its own isolated environment.
export function codexClaudeEnvironment(root: string, inherited: Environment): Environment {
  return {
    ...inherited,
    CODEX_HOME: path.join(root, 'codex'),
    CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '0',
  };
}

export function clearEnvironment(env: Environment, names: string[], prefixes: string[] = []): void {
  for (const key of Object.keys(env)) {
    const name = key.toUpperCase();
    if (names.includes(name) || prefixes.some(prefix => name.startsWith(prefix))) delete env[key];
  }
}
