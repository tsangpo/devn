import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Platform } from '../types';
import { privateDir, privateFile, atomicWrite } from './files';
import { runAttached } from './process';
import { environmentValue } from './system';

export const windows: Platform = {
  defaultConfigRoot: () => environmentValue(process.env, 'LOCALAPPDATA') || path.join(os.homedir(), 'AppData', 'Local'),
  privateDir, privateFile, atomicWrite, runAttached,
  projectPath: dir => fs.realpathSync.native(dir).replace(/^[a-z]:/, drive => drive.toUpperCase()),
  profileIdentity: id => id.toLowerCase(),
  // Device names cannot identify ordinary Windows directories, even with an extension.
  validProfileName: id => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id),
};
