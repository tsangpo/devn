import { checkedAssets, formula, releaseTag } from './release-lib';
releaseTag();
const hashes = await checkedAssets('release');
await Bun.write('release/SHA256SUMS', Object.entries(hashes).map(([name, hash]) => hash + '  ' + name).join('\n') + '\n');
await Bun.write('release/devn.rb', formula(hashes));
console.log('All release archives verified; generated Formula and SHA256SUMS.');
