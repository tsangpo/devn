import path from 'node:path';
import fs from 'node:fs';
import { privateDir } from './files';
import { platform } from './platform';
import { modelIds, type Profile } from './registry';
import type { Environment } from './platform/types';

const commands = new Set(['run', 'mini', 'models', 'session', 'stats', 'debug', 'acp', 'mcp', 'plugin', 'reload']);
const valueFlags = new Set(['--prompt', '--session', '-s', '--agent', '--format', '--file', '-f', '--title', '--model', '-m', '--replay-limit', '--max-count', '-n', '--days', '--year', '--project', '--limit', '--url', '--header', '--env']);
const rootFlags = new Set(['--continue', '-c', '--auto', '--yolo', '--dangerously-skip-permissions', '--help', '-h', '--version', '-v', '--print-logs']);
const forbidden = new Set(['--server', '--attach', '--directory', '--cwd', '--cd', '-C', '--config', '--config-dir', '--no-standalone']);

// Inspect option values separately: a prompt whose text is "--server" is not an override.
export function openCodeArgs(args: string[], profile: Profile): { args: string[]; model?: string } {
  if (!profile.opencode) throw new Error('Add an opencode section with model and models to the remote profile first.');
  const command = args[0] && !args[0].startsWith('-') ? args[0] : '';
  if (command && !commands.has(command)) throw new Error('Unsupported OpenCode command or directory override. Start devn in the bound project; manage installations and shared services outside devn.');
  // v2's client-side plugin discovery does not honor the server's project-config
  // switch. Refuse ambient TUI plugins instead of silently executing them.
  if (!command || command === 'plugin') {
    for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
      const plugins = path.join(dir, '.opencode', 'plugins');
      if (fs.existsSync(plugins) && fs.readdirSync(plugins).length) throw new Error('Project TUI plugins are incompatible with profile-only mode. Move them into the profile opencode/plugins directory.');
      if (path.dirname(dir) === dir) break;
    }
  }
  const output: string[] = command ? [command] : [];
  let model: string | undefined;
  const ids = new Set(modelIds(profile, 'opencode'));
  for (let i = command ? 1 : 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      if (!command && i + 1 < args.length) throw new Error('Directory overrides conflict with the project profile.');
      output.push(...args.slice(i)); break;
    }
    const flag = arg.split('=')[0];
    if (command === 'mcp' && args[1] === 'add' && (flag === '--no-global' || arg === '--global=false')) throw new Error('MCP configuration must use the profile global directory.');
    if (forbidden.has(flag) || /^-C.+/.test(arg)) throw new Error(`${flag} conflicts with the project profile.`);
    if (flag === '--standalone') {
      if (arg.includes('=') && arg !== '--standalone=true') throw new Error('OpenCode requires standalone mode.');
      continue;
    }
    const compactModel = /^-m[^-]/.test(arg);
    if (flag === '--model' || flag === '-m' || compactModel) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : compactModel ? arg.slice(2) : args[++i];
      if (!value || !ids.has(value)) throw new Error(`Model must be one of the opencode models in profile ${profile.id} (bifrost/<model>).`);
      model = value;
      // The v2 root TUI has no --model flag; set its default via config content instead.
      if (command) output.push('--model', value);
      continue;
    }
    if (!command && !rootFlags.has(flag) && !['--prompt', '--session', '-s'].includes(flag)) {
      throw new Error('Unsupported OpenCode TUI argument or directory override. Use devn opencode --help.');
    }
    output.push(arg);
    if (valueFlags.has(flag) && !arg.includes('=')) {
      if (args[i + 1] === undefined) throw new Error(`Missing value for ${flag}.`);
      output.push(args[++i]);
    }
  }
  if (!command || ['run', 'mini', 'models', 'stats', 'reload'].includes(command)) output.splice(command ? 1 : 0, 0, '--standalone');
  else if (command === 'session' && output[1] && !output[1].startsWith('-')) output.splice(2, 0, '--standalone');
  if (command === 'mcp' && output[1] === 'add' && !output.includes('--global')) output.splice(2, 0, '--global');
  // Other supported commands either start a private server themselves (ACP), or
  // consult the profile's devn-owned service.json with disabled:true.
  return { args: output, model: command ? undefined : model };
}

export function openCodeEnvironment(root: string, inherited: Environment): Environment {
  const env = { ...inherited };
  // Keep terminal/UI preferences, but remove every upstream connection/path override.
  const preferences = new Set(['OPENCODE_GIT_BASH_PATH', 'OPENCODE_DISABLE_MOUSE', 'OPENCODE_DISABLE_TERMINAL_TITLE', 'OPENCODE_DISABLE_FFF']);
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('OPENCODE_') && !preferences.has(key.toUpperCase())) delete env[key];
  for (const key of Object.keys(env)) if (['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR', 'TMP', 'TEMP'].includes(key.toUpperCase())) delete env[key];
  const dir = path.join(root, 'opencode');
  privateDir(dir);
  for (const [kind, variable] of [['config', 'XDG_CONFIG_HOME'], ['data', 'XDG_DATA_HOME'], ['cache', 'XDG_CACHE_HOME'], ['state', 'XDG_STATE_HOME']] as const) {
    const base = path.join(dir, kind);
    privateDir(base);
    privateDir(path.join(base, 'opencode'));
    env[variable] = base;
  }
  const tmp = path.join(dir, 'tmp');
  privateDir(tmp);
  env.TMPDIR = env.TMP = env.TEMP = tmp;
  env.OPENCODE_CONFIG_DIR = dir;
  env.OPENCODE_CONFIG_PROJECT_DISABLE = '1';
  env.OPENCODE_DISABLE_MODELS_FETCH = '1';
  env.OPENCODE_DISABLE_AUTOUPDATE = '1';
  return env;
}

export function openCodeCommand(env: Environment): string {
  for (const command of ['opencode', 'opencode2']) {
    let argv: string[];
    try { argv = platform.resolveCommand(command, ['--version'], env); }
    catch { continue; }
    try {
      const result = Bun.spawnSync(argv, { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
      const version = result.stdout.toString().trim().match(/^(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)$/i);
      if (result.exitCode === 0 && version && Number(version[1]) === 2 && (Number(version[2]) > 0 || Number(version[3]) >= 21)) return command;
    } catch { /* Try the separately installed v2 alias. Never print probe output. */ }
  }
  throw new Error('OpenCode v2 >=2.0.21 is required. Install or upgrade the official @opencode/cli client and put opencode or opencode2 on PATH.');
}
