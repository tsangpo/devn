import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ClientCommand, Platform } from './types';

export function privateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`Refusing symlink directory: ${dir}`);
  fs.chmodSync(dir, 0o700);
}

export function privateFile(file: string): void {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing symlink file: ${file}`);
  fs.chmodSync(file, 0o600);
}

export function atomicWrite(file: string, content: string, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(`Refusing symlink file: ${file}`);
  }
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}



export async function runAttached({ name: command }: ClientCommand, args: string[], env: Record<string, string | undefined>): Promise<number> {
  let child;
  try {
    child = Bun.spawn([command, ...args], {
      env, stdio: ['inherit', 'inherit', 'inherit'],
    });
  } catch (error: any) {
    throw new Error(error.code === 'ENOENT' ? `${command} is not installed or not on PATH.` : `Cannot start ${command} (${error.code || 'unknown error'}).`);
  }
  let stopping = false;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const handlers = signals.map(signal => {
    const handler = () => { if (!stopping) { stopping = true; child.kill(signal); } };
    process.on(signal, handler);
    return handler;
  });
  try {
    const code = await child.exited;
    return child.signalCode ? 128 + (os.constants.signals[child.signalCode] || 1) : code;
  } finally {
    signals.forEach((signal, i) => process.off(signal, handlers[i]));
  }
}

export const posix: Platform = {
  hasDesktop: () => !process.env.SSH_CONNECTION && !process.env.SSH_TTY &&
    (os.type() === 'Darwin' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)),
  async openBrowser(url) {
    const child = Bun.spawn([os.type() === 'Darwin' ? 'open' : 'xdg-open', url], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (await child.exited !== 0) throw new Error('Cannot open browser.');
  },
  defaultConfigRoot: () => path.join(os.homedir(), '.config'),
  privateDir, privateFile, atomicWrite, runAttached,
  resolveCommand: ({ name: command }, args, env) => {
    const entry = Bun.which(command, { PATH: env.PATH });
    if (!entry) throw new Error(`${command} is not installed or not on PATH.`);
    return [entry, ...args];
  },
  projectPath: dir => fs.realpathSync.native(dir),
  storedProjectPath: dir => dir,
  profileIdentity: id => id,
  validProfileName: () => true,
};
