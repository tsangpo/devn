import { $ } from 'bun';
import { version, releaseTag, verifyArchive } from './release-lib';
releaseTag();
const archive = 'release/devn.tgz';
await verifyArchive(archive);
const response = await fetch('https://registry.npmjs.org/devn/' + version);
if (response.status === 404) {
  await $`npm publish ${archive} --access public --provenance --ignore-scripts`;
} else if (response.ok) {
  const published = await response.json() as { dist?: { integrity?: string } };
  const integrity = 'sha512-' + new Bun.CryptoHasher('sha512').update(await Bun.file(archive).arrayBuffer()).digest('base64');
  if (published.dist?.integrity !== integrity) throw new Error('This npm version already exists with different contents. Publish a new version.');
  console.log('Identical npm package already published; continuing.');
} else {
  throw new Error('Cannot check npm version: HTTP ' + response.status);
}
