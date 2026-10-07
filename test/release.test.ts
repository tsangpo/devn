import * as tempFS from 'node:fs';
import * as tempOS from 'node:os';
import * as tempPath from 'node:path';
import { testPlatform, prependPath } from './platform';
import { $ } from 'bun';
import { expect, test } from 'bun:test';
import { archiveName, assertNoDowngrade, assetNames, checkedAssets, digest, formula, platforms, releaseTag, shouldPromoteRelease, version } from '../scripts/release-lib';
import { renderInstaller } from '../scripts/build-installer';

test('installer generation pins the release archive and rejects invalid checksums', async () => {
  const hash = 'a'.repeat(64);
  const installer = await renderInstaller(hash);
  expect(installer).toContain("$version = '" + version + "'");
  expect(installer).toContain("$archiveName = '" + archiveName('windows-x64') + "'");
  expect(installer).toContain("$expectedHash = '" + hash + "'");
  expect(installer).not.toContain('@@');
  expect(await renderInstaller(hash)).toBe(installer);
  await expect(renderInstaller('bad hash')).rejects.toThrow('Invalid Windows archive');
});

test('installer build verifies its input and writes a reproducible checksummed asset', async () => {
  const temp = tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-installer-build-'));
  try {
    const archive = tempPath.join(temp, 'release', archiveName('windows-x64'));
    await Bun.write(archive, 'fixture archive');
    const hash = await digest(archive);
    await Bun.write(archive + '.sha256', hash + '\n');
    const build = () => Bun.spawnSync([process.execPath, tempPath.resolve(import.meta.dir, '../scripts/build-installer.ts')], {
      cwd: temp, stdout: 'pipe', stderr: 'pipe',
    });
    const result = build();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const output = tempPath.join(temp, 'release/install.ps1');
    const original = await Bun.file(output).text();
    expect(original).toBe(await renderInstaller(hash));
    expect((await Bun.file(output + '.sha256').text()).trim()).toBe(await digest(output));
    expect(build().exitCode).toBe(0);
    expect(await Bun.file(output).text()).toBe(original);
    await Bun.write(archive, 'tampered archive');
    expect(build().exitCode).not.toBe(0);
    expect(await Bun.file(output).text()).toBe(original);
  } finally { tempFS.rmSync(temp, { recursive: true, force: true }); }
});

test('release tags must match the stable package version', () => {
  expect(releaseTag('v' + version)).toBe('v' + version);
  for (const tag of [version, 'v999.0.0', 'v' + version + '-rc.1', 'v' + version + '/unsafe']) {
    expect(() => releaseTag(tag)).toThrow();
  }
});

test('Latest promotion compares stable versions numerically and preserves newer releases', () => {
  expect(shouldPromoteRelease('v0.9.0', 'v0.10.0')).toBe(true);
  expect(shouldPromoteRelease('v1.0.0', 'v1.0.0')).toBe(true);
  expect(shouldPromoteRelease('v1.0.0', 'v0.10.0')).toBe(false);
  expect(() => shouldPromoteRelease('unknown')).toThrow();
  expect(() => shouldPromoteRelease('v1.0.0-rc.1')).toThrow();
});

test('release preparation rejects missing and tampered artifacts', async () => {
  const temp = tempFS.realpathSync.native(tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-test-')));
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
  const temp = tempFS.realpathSync.native(tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-test-')));
  const root = Bun.fileURLToPath(new URL('../', import.meta.url));
  try {
    await $`mkdir -p ${temp + '/release'} ${temp + '/bin'} ${temp + '/remote'}`.quiet();
    for (const name of assetNames()) {
      await Bun.write(temp + '/release/' + name, 'dummy ' + name);
      await Bun.write(temp + '/release/' + name + '.sha256', await digest(temp + '/release/' + name));
    }
    await Bun.write(temp + '/release/SHA256SUMS', 'test manifest');
    testPlatform.writeExecutable(temp + '/bin/gh', `import { readdirSync, copyFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const remote = process.env.MOCK_REMOTE;
const value = flag => args[args.indexOf(flag) + 1];
if (args[0] === 'api') {
  if (process.env.MOCK_LATEST_ERROR) {
    console.error(process.env.MOCK_LATEST_ERROR);
    process.exit(1);
  }
  console.log(process.env.MOCK_LATEST || 'v0.0.0');
  process.exit(0);
}
if (args[0] !== 'release') process.exit(99);
if (args[1] === 'view') console.log(JSON.stringify({isDraft: process.env.MOCK_PUBLISHED !== '1', assets: readdirSync(remote).map(name => ({name}))}));
else if (args[1] === 'upload') copyFileSync(args[3], remote + '/' + args[3].split('/').at(-1));
else if (args[1] === 'download') copyFileSync(remote + '/' + value('--pattern'), value('--dir') + '/' + value('--pattern'));
else if (args[1] === 'edit') appendFileSync(process.env.MOCK_EDITS, JSON.stringify(args) + '\\n');
else process.exit(99);
`);
    const env = { ...prependPath(temp + '/bin'), RELEASE_TAG: 'v' + version, MOCK_REMOTE: temp + '/remote', MOCK_EDITS: temp + '/edits' };
    const run = async (mode: string, extra: Record<string, string> = {}) => {
      const child = Bun.spawn([process.execPath, root + '/scripts/publish-github.ts', mode], {
        cwd: temp, env: { ...env, ...extra }, stdout: 'pipe', stderr: 'pipe',
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
    await run('publish', { MOCK_PUBLISHED: '1' });
    await run('publish', { MOCK_LATEST_ERROR: 'HTTP 404' });
    await run('publish', { MOCK_LATEST: 'v999.0.0' });
    await run('publish', { MOCK_PUBLISHED: '1', MOCK_LATEST: 'v999.0.0' });
    await expect(run('publish', { MOCK_LATEST_ERROR: 'HTTP 403' })).rejects.toThrow('Cannot inspect latest');
    const edits = (await Bun.file(temp + '/edits').text()).trim().split('\n').map(line => JSON.parse(line));
    expect(edits.map(args => args.at(-1))).toEqual(['--latest=true', '--latest=true', '--latest=true', '--latest=false']);
    expect(await Bun.file(temp + '/remote/devn.tgz').text()).toBe('dummy devn.tgz');
    await Bun.write(temp + '/remote/devn.tgz', 'different existing asset');
    await expect(run('stage')).rejects.toThrow();
    expect(await Bun.file(temp + '/remote/devn.tgz').text()).toBe('different existing asset');
  } finally {
    tempFS.rmSync(temp, { recursive: true, force: true });
  }
}, testPlatform.timeout);
