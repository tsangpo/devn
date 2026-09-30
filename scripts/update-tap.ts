import { $ } from 'bun';
import { assertNoDowngrade, checkedAssets, formula, releaseTag, version } from './release-lib';
releaseTag();
const directory = process.argv[2];
if (!directory) throw new Error('Specify the checked-out Homebrew tap directory.');
const output = formula(await checkedAssets('release'));
const file = directory + '/Formula/devn.rb';
if (await Bun.file(file).exists()) {
  const existing = await Bun.file(file).text();
  assertNoDowngrade(existing);
  if (existing === output) { console.log('Formula already up to date.'); process.exit(0); }
  if (existing.match(/^\s*version "([^"]+)"/m)?.[1] === version) throw new Error('Formula for this version already exists with different contents.');
}
await Bun.write(file, output);
await $`git add -- Formula/devn.rb`.cwd(directory);
await $`git -c user.name=github-actions[bot] -c user.email=41898282+github-actions[bot]@users.noreply.github.com commit -m ${'devn ' + version}`.cwd(directory);
await $`git push origin HEAD:main`.cwd(directory);
