import * as tempFS from 'node:fs';
import * as tempOS from 'node:os';
import * as tempPath from 'node:path';
import { $ } from 'bun';
import { expect, test } from 'bun:test';

const root = Bun.fileURLToPath(new URL('../', import.meta.url));

test('published tarball installs locally and exposes devn through bunx', async () => {
  const temp = tempFS.realpathSync.native(tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-test-')));
  try {
    const archive = process.env.DEVN_PACKAGE_TARBALL || `${temp}/devn.tgz`;
    const project = `${temp}/consumer`;
    if (!process.env.DEVN_PACKAGE_TARBALL) await $`${process.execPath} pm pack --ignore-scripts --filename ${archive}`.cwd(root).quiet();
    const files = (await $`tar -tzf ${archive}`.text()).trim().split(/\r?\n/);
    expect(files).toContain('package/bin/devn');
    expect(files).toContain('package/src/main.ts');
    expect(files).toContain('package/profiles/example.json');
    for (const file of files) {
      expect(file).toMatch(/^package\/(?:bin\/devn|src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.ts|profiles\/example\.json|README(?:\.zh-CN)?\.md|CHANGELOG\.md|CONTRIBUTING\.md|SECURITY\.md|LICENSE|package\.json)$/);
    }
    await $`mkdir -p ${project}`.quiet();
    await Bun.write(`${project}/package.json`, JSON.stringify({
      private: true, dependencies: { '@tsangpo/devn': `file:${archive}` },
    }));
    const env = { ...process.env, BUN_INSTALL_CACHE_DIR: `${temp}/cache`, XDG_CONFIG_HOME: `${temp}/config` };
    await $`${process.execPath} install --ignore-scripts --no-progress`.cwd(project).env(env).quiet();
    const manifest = await Bun.file(`${project}/node_modules/@tsangpo/devn/package.json`).json();
    expect(manifest.name).toBe('@tsangpo/devn');
    expect(manifest.license).toBe('MIT');
    expect(manifest.version).toBe((await Bun.file(root + '/package.json').json()).version);
    expect(manifest.repository.url).toBe('git+https://github.com/tsangpo/devn.git');
    const version = await $`${process.execPath} x --no-install @tsangpo/devn --version`.cwd(project).env(env).text();
    expect(version.trim()).toBe(manifest.version);
    expect(manifest.bin.devn).toBe('bin/devn');
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    const help = await $`${process.execPath} x --no-install @tsangpo/devn --help`.cwd(project).env(env).text();
    expect(help).toContain('devn profile add');
    const list = await $`${process.execPath} x --no-install @tsangpo/devn profile list`.cwd(project).env(env).text();
    expect(list).toContain('No profiles registered');
  } finally {
    tempFS.rmSync(temp, { recursive: true, force: true });
  }
}, 20000);
