import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const configHome = () => path.resolve(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'devn');
export const profileDir = (id: string) => path.join(configHome(), 'profiles', id);

export function privateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`Refusing symlink directory: ${dir}`);
  fs.chmodSync(dir, 0o700);
}

export function privateFile(file: string): void {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing symlink file: ${file}`);
  fs.chmodSync(file, 0o600);
}

export function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`Cannot read valid JSON from ${file}. The file has not been changed.`); }
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

export function writeJson(file: string, data: unknown, mode = 0o600): void {
  atomicWrite(file, JSON.stringify(data, null, 2) + '\n', mode);
}

// Atomic mkdir works on both Linux and macOS, without requiring flock.
export async function acquireLock(dir: string, waitMs = 15000): Promise<() => void> {
  privateDir(path.dirname(dir));
  const deadline = Date.now() + waitMs;
  const owner = { pid: process.pid, host: os.hostname(), token: randomUUID() };
  while (true) {
    try {
      fs.mkdirSync(dir, { mode: 0o700 });
      writeJson(path.join(dir, 'owner.json'), owner);
      return () => {
        try {
          if (readJson(path.join(dir, 'owner.json')).token === owner.token) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        } catch { /* Already released. */ }
      };
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
    }
    try {
      const current = readJson(path.join(dir, 'owner.json'));
      if (current.host === os.hostname() && Number.isInteger(current.pid) && current.pid > 0) {
        try { process.kill(current.pid, 0); }
        catch (error: any) {
          if (error.code === 'ESRCH') fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    } catch {
      // Allow an interrupted mkdir/write sequence to expire, never a fresh lock.
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > 30000) fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* Another waiter removed it. */ }
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${dir}. Try again shortly.`);
    await delay(75);
  }
}
