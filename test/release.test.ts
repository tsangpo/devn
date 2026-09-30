import { $ } from 'bun';
import { expect, test } from 'bun:test';
import { archiveName, assertNoDowngrade, assetNames, checkedAssets, digest, formula, platforms, releaseTag, version } from '../scripts/release-lib';

test('release tags must match the stable package version', () => {
  expect(releaseTag('v' + version)).toBe('v' + version);
  for (const tag of [version, 'v999.0.0', 'v' + version + '-rc.1', 'v' + version + '/unsafe']) {
    expect(() => releaseTag(tag)).toThrow();
  }
});

test('release preparation rejects missing and tampered artifacts', async () => {
  const temp = (await $`mktemp -d`.text()).trim();
  try {
    await expect(checkedAssets(temp)).rejects.toThrow();
    for (const name of assetNames()) {
      await Bun.write(temp + '/' + name, 'test archive ' + name);
      await Bun.write(temp + '/' + name + '.sha256', await digest(temp + '/' + name));
    }
    const hashes = await checkedAssets(temp);
    expect(Object.keys(hashes).length).toBe(5);
    const output = formula(hashes);
    expect(output).toContain('bin.install "devn"');
    expect(output).not.toContain('depends_on "bun"');
    for (const platform of platforms) {
      const name = archiveName(platform);
      expect(output).toContain('/releases/download/v' + version + '/' + name);
      expect(output).toContain('sha256 "' + hashes[name] + '"');
    }
    delete hashes[archiveName('linux-arm64')];
    expect(() => formula(hashes)).toThrow();
    await Bun.write(temp + '/devn.tgz', 'tampered');
    await expect(checkedAssets(temp)).rejects.toThrow('checksum mismatch');
  } finally {
    await $`rm -rf ${temp}`.quiet();
  }
});

test('tap updates compare numeric versions and refuse downgrade or unknown formats', () => {
  expect(() => assertNoDowngrade('  version "0.9.0"', '0.10.0')).not.toThrow();
  expect(() => assertNoDowngrade('  version "1.0.0"', '1.0.0')).not.toThrow();
  expect(() => assertNoDowngrade('  version "1.0.0"', '0.10.0')).toThrow('downgrade');
  expect(() => assertNoDowngrade('unrecognized')).toThrow();
});
