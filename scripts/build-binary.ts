import fs from 'node:fs';
import { targets, hostPlatform } from './platform';
import { archiveName, digest, platforms, type Platform } from './release-lib';

const platform = (process.argv[2] || hostPlatform()) as Platform;
if (!platforms.includes(platform)) throw new Error('Unsupported binary platform: ' + platform);
const root = Bun.fileURLToPath(new URL('../', import.meta.url));
const staging = root + '/release/' + platform;
fs.mkdirSync(staging, { recursive: true });
const target = targets[platform];
const result = await Bun.build({
  entrypoints: [root + '/src/main.ts'],
  compile: {
    target: ('bun-' + platform) as Bun.Build.CompileTarget, outfile: staging + '/' + target.executable,
    // Do not load runtime configuration from the caller's project.
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: false,
    autoloadPackageJson: false,
  },
  minify: true,
});
if (!result.success) throw new AggregateError(result.logs, 'Binary compilation failed.');
await Bun.write(staging + '/LICENSE', Bun.file(root + '/LICENSE'));
const archive = root + '/release/' + archiveName(platform);
await target.archive.pack(archive, staging);
await Bun.write(archive + '.sha256', await digest(archive) + '\n');
console.log(archive);
