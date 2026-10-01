import * as tempFS from 'node:fs';
import * as tempOS from 'node:os';
import * as tempPath from 'node:path';
import { $ } from 'bun';
import { checkedAssets, releaseTag, repository, digest } from './release-lib';

const tag = releaseTag();
const hashes = await checkedAssets('release');
const files = [...Object.keys(hashes).flatMap(name => [name, name + '.sha256']), 'SHA256SUMS'];
const mode = process.argv[2];
if (!['stage', 'publish'].includes(mode)) throw new Error('Expected stage or publish.');
const result = await $`gh release view ${tag} --repo ${repository} --json isDraft,assets`.nothrow().quiet();
let release;
if (result.exitCode === 0) release = JSON.parse(result.stdout.toString());
else if (!result.stderr.toString().includes('release not found') && !result.stderr.toString().includes('HTTP 404')) throw new Error('Cannot inspect GitHub release.');

if (!release) {
  if (mode !== 'stage') throw new Error('Release has not been staged.');
  // Create the draft first so a partial upload can be resumed without replacing assets.
  await $`gh release create ${tag} --repo ${repository} --verify-tag --draft --title ${tag} --generate-notes`;
  release = JSON.parse(await $`gh release view ${tag} --repo ${repository} --json isDraft,assets`.text());
}
const temp = tempFS.realpathSync(tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-test-')));
try {
  for (const name of files) {
    if (release.assets.some((asset: { name: string }) => asset.name === name)) {
      await $`gh release download ${tag} --repo ${repository} --pattern ${name} --dir ${temp}`.quiet();
      if (await digest(temp + '/' + name) !== await digest('release/' + name)) {
        throw new Error('Existing release asset differs: ' + name + '. Re-run failed jobs with their original artifacts, or use a new version.');
      }
    } else {
      if (!release.isDraft || mode !== 'stage') throw new Error('Release asset missing: ' + name);
      await $`gh release upload ${tag} ${'release/' + name} --repo ${repository}`;
    }
  }
  if (mode === 'publish' && release.isDraft) await $`gh release edit ${tag} --repo ${repository} --draft=false --latest=false`;
} finally {
  tempFS.rmSync(temp, { recursive: true, force: true });
}
