import { $ } from 'bun';
import * as zip from './windows/archive';

const tar = {
  async pack(archive: string, directory: string) { await $`tar -czf ${archive} -C ${directory} devn LICENSE`.quiet(); },
  async entries(archive: string) { return (await $`tar -tzf ${archive}`.text()).trim().split('\n'); },
  async extract(archive: string, directory: string) { await $`tar -xzf ${archive} -C ${directory}`.quiet(); },
};
export const targets = {
  'darwin-arm64': { host: 'darwin', arch: 'arm64', executable: 'devn', extension: '.tar.gz', archive: tar },
  'darwin-x64': { host: 'darwin', arch: 'x64', executable: 'devn', extension: '.tar.gz', archive: tar },
  'linux-arm64': { host: 'linux', arch: 'arm64', executable: 'devn', extension: '.tar.gz', archive: tar },
  'linux-x64': { host: 'linux', arch: 'x64', executable: 'devn', extension: '.tar.gz', archive: tar },
  'windows-x64': { host: 'win32', arch: 'x64', executable: 'devn.exe', extension: '.zip', archive: zip },
} as const;
export type Platform = keyof typeof targets;
export const platforms = Object.keys(targets) as Platform[];
export function hostPlatform(): Platform {
  const platform = platforms.find(p => targets[p].host === process.platform && targets[p].arch === process.arch);
  if (!platform) throw new Error('Unsupported binary platform.');
  return platform;
}
