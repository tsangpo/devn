import fs from 'node:fs';
import path from 'node:path';
import type { Environment } from '../types';
import { environmentValue } from './system';

function executable(command: string, env: Environment): string | undefined {
  const extensions = (environmentValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const directory of (environmentValue(env, 'PATH') || '').split(';').filter(Boolean)) {
    const base = path.resolve(directory.replace(/^"|"$/g, ''), command);
    for (const file of [base, ...extensions.map(ext => base + ext)]) {
      try { if (fs.statSync(file).isFile()) return file; } catch { /* Continue along PATH. */ }
    }
  }
}

export function resolveCommand(command: string, args: string[], env: Environment): string[] {
  const entry = executable(command, env);
  if (!entry) throw new Error(`${command} is not installed or not on PATH.`);
  if (/\.exe$/i.test(entry)) return [entry, ...args];
  const packageName = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code', opencode: '@opencode/cli', opencode2: '@opencode/cli' }[command];
  if (!packageName) throw new Error(`Unsupported Windows entry for ${command}; use an official installation.`);
  const directory = path.dirname(entry);
  const packageRoot = path.join(path.basename(directory).toLowerCase() === '.bin'
    ? path.dirname(directory) : path.join(directory, 'node_modules'), packageName);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[command];
    if (manifest.name !== packageName || typeof bin !== 'string') throw new Error();
    const root = fs.realpathSync.native(packageRoot);
    const target = fs.realpathSync.native(path.resolve(packageRoot, bin));
    const relative = path.relative(root, target);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error();
    if (/\.exe$/i.test(target)) return [target, ...args];
    if (!/\.(?:c?js|mjs)$/i.test(target)) throw new Error();
    const node = executable('node.exe', env);
    if (!node) throw new Error('NODE_MISSING');
    return [node, target, ...args];
  } catch (error: any) {
    if (error.message === 'NODE_MISSING') throw new Error(`${command}'s npm entry requires Node.js on PATH.`);
    throw new Error(`Cannot resolve the official npm entry for ${command}; reinstall the official client or use its native EXE.`);
  }
}

export async function runAttached(command: string, args: string[], env: Environment): Promise<number> {
  env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toUpperCase(), value]));
  const argv = resolveCommand(command, args, env);
  let child;
  try { child = Bun.spawn(argv, { env, stdio: ['inherit', 'inherit', 'inherit'] }); }
  catch { throw new Error(`Cannot start ${command}. Check its installation.`); }
  // Console events already reach the attached child. kill(SIGINT) would terminate it.
  const ignore = () => {};
  process.on('SIGINT', ignore);
  process.on('SIGBREAK', ignore);
  try { return await child.exited; }
  finally { process.off('SIGINT', ignore); process.off('SIGBREAK', ignore); }
}
