import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { platform } from './platform';

export const configHome = () => path.resolve(process.env.DEVN_CONFIG_HOME || process.env.XDG_CONFIG_HOME || platform.defaultConfigRoot(), 'devn');
export const profileDir = (id: string) => path.join(configHome(), 'profiles', id);
export const { privateDir, privateFile, atomicWrite } = platform;

export function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`Cannot read valid JSON from ${file}. The file has not been changed.`); }
}

export function writeJson(file: string, data: unknown, mode = 0o600): void {
  atomicWrite(file, JSON.stringify(data, null, 2) + '\n', mode);
}

// Atomic directory creation provides a process lock without a platform-specific daemon.
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
