import { version, releaseTag } from './release-lib';

const root = Bun.fileURLToPath(new URL('../', import.meta.url));
releaseTag();
const directory = root + '/release';
const mkdir = Bun.spawnSync(['mkdir', '-p', directory]);
if (mkdir.exitCode !== 0) throw new Error('Cannot create release directory.');
const archive = directory + '/devn.tgz';
const pack = Bun.spawn([process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', archive], {
  cwd: root, stdio: ['ignore', 'inherit', 'inherit'],
});
if (await pack.exited !== 0) throw new Error('Packing failed.');
const hash = new Bun.CryptoHasher('sha256').update(await Bun.file(archive).arrayBuffer()).digest('hex');
await Bun.write(archive + '.sha256', hash + '\n');
console.log('Prepared devn ' + version + ': ' + hash);
