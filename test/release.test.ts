import * as tempFS from 'node:fs';
import * as tempOS from 'node:os';
import * as tempPath from 'node:path';
import { testPlatform, prependPath } from './platform';
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
  const temp = tempFS.realpathSync(tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-test-')));
  try {
    await expect(checkedAssets(temp)).rejects.toThrow();
    for (const name of assetNames()) {
      await Bun.write(temp + '/' + name, 'test archive ' + name);
      await Bun.write(temp + '/' + name + '.sha256', await digest(temp + '/' + name));
    }
    const hashes = await checkedAssets(temp);
    expect(Object.keys(hashes).length).toBe(assetNames().length);
    const output = formula(hashes);
    expect(output).toContain('bin.install "devn"');
    expect(output).not.toContain('depends_on "bun"');
    for (const platform of platforms.filter(p => p.startsWith('darwin-') || p.startsWith('linux-'))) {
      const name = archiveName(platform);
      expect(output).toContain('/releases/download/v' + version + '/' + name);
      expect(output).toContain('sha256 "' + hashes[name] + '"');
    }
    delete hashes[archiveName('linux-arm64')];
    expect(() => formula(hashes)).toThrow();
    await Bun.write(temp + '/devn.tgz', 'tampered');
    await expect(checkedAssets(temp)).rejects.toThrow('checksum mismatch');
  } finally {
    tempFS.rmSync(temp, { recursive: true, force: true });
  }
});

test('tap updates compare numeric versions and refuse downgrade or unknown formats', () => {
  expect(() => assertNoDowngrade('  version "0.9.0"', '0.10.0')).not.toThrow();
  expect(() => assertNoDowngrade('  version "1.0.0"', '1.0.0')).not.toThrow();
  expect(() => assertNoDowngrade('  version "1.0.0"', '0.10.0')).toThrow('downgrade');
  expect(() => assertNoDowngrade('unrecognized')).toThrow();
});

test('GitHub staging finds draft releases and resumes without replacing assets', async () => {
  const temp = tempFS.realpathSync(tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-test-')));
  const root = Bun.fileURLToPath(new URL('../', import.meta.url));
  try {
    await $`mkdir -p ${temp + '/release'} ${temp + '/bin'} ${temp + '/remote'}`.quiet();
    for (const name of assetNames()) {
      await Bun.write(temp + '/release/' + name, 'dummy ' + name);
      await Bun.write(temp + '/release/' + name + '.sha256', await digest(temp + '/release/' + name));
    }
    await Bun.write(temp + '/release/SHA256SUMS', 'test manifest');
    testPlatform.writeExecutable(temp + '/bin/gh', `import { readdirSync, copyFileSync } from 'node:fs';
const args = process.argv.slice(2);
const remote = process.env.MOCK_REMOTE;
const value = flag => args[args.indexOf(flag) + 1];
if (args[0] !== 'release') process.exit(99);
if (args[1] === 'view') console.log(JSON.stringify({isDraft: true, assets: readdirSync(remote).map(name => ({name}))}));
else if (args[1] === 'upload') copyFileSync(args[3], remote + '/' + args[3].split('/').at(-1));
else if (args[1] === 'download') copyFileSync(remote + '/' + value('--pattern'), value('--dir') + '/' + value('--pattern'));
else if (args[1] !== 'edit') process.exit(99);
`);
    const env = { ...prependPath(temp + '/bin'), RELEASE_TAG: 'v' + version, MOCK_REMOTE: temp + '/remote' };
    const run = async (mode: string) => {
      const child = Bun.spawn([process.execPath, root + '/scripts/publish-github.ts', mode], {
        cwd: temp, env, stdout: 'pipe', stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        const [code, , stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        if (code !== 0) throw new Error(stderr || 'Publishing test process failed.');
      } finally { clearTimeout(timer); }
    };
    await run('stage');
    await run('stage');
    await run('publish');
    expect(await Bun.file(temp + '/remote/devn.tgz').text()).toBe('dummy devn.tgz');
    await Bun.write(temp + '/remote/devn.tgz', 'different existing asset');
    await expect(run('stage')).rejects.toThrow();
    expect(await Bun.file(temp + '/remote/devn.tgz').text()).toBe('different existing asset');
  } finally {
    tempFS.rmSync(temp, { recursive: true, force: true });
  }
}, testPlatform.timeout);
