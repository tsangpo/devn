import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Platform } from '../types';
import { privateDir, privateFile, atomicWrite } from './files';
import { runAttached, resolveCommand } from './process';
import { environmentValue } from './system';

const projectPath = (dir: string) => fs.realpathSync.native(dir).replace(/^[a-z]:/, drive => drive.toUpperCase());

export const windows: Platform = {
  hasDesktop: () => !process.env.SSH_CONNECTION && !process.env.SSH_TTY && process.env.SESSIONNAME !== 'Services',
  async openBrowser(url) {
    const child = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:DEVN_BROWSER_URL'],
      { env: { ...process.env, DEVN_BROWSER_URL: url }, stdio: ['ignore', 'ignore', 'ignore'] });
    if (await child.exited !== 0) throw new Error('Cannot open browser.');
  },
  defaultConfigRoot: () => environmentValue(process.env, 'LOCALAPPDATA') || path.join(os.homedir(), 'AppData', 'Local'),
  privateDir, privateFile, atomicWrite, runAttached, resolveCommand,
  projectPath,
  storedProjectPath(dir) {
    try { return projectPath(dir); } catch (error: any) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
      return dir;
    }
  },
  profileIdentity: id => id.toLowerCase(),
  // Device names cannot identify ordinary Windows directories, even with an extension.
  validProfileName: id => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id),
};
