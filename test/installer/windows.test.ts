import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { archiveName, verifyArchive, version } from '../../scripts/release-lib';
import { renderInstaller } from '../../scripts/build-installer';

const root = path.resolve(import.meta.dir, '../..');
const windows = process.platform === 'win32';
const shells = ['powershell.exe', 'pwsh.exe'];

function shellEnvironment(): NodeJS.ProcessEnv {
  // CI launches Bun from pwsh. Passing its module path through an intermediate
  // process makes Windows PowerShell load incompatible PowerShell 7 modules.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
}

// These tests write and restore HKCU\Environment\Path. Run only in the dedicated installer job,
// never concurrently with other installer tests or against a developer's default install directory.
describe.skipIf(!windows)('Windows standalone installer', () => {
  for (const shell of shells) {
    test(`${shell}: install, repeat, upgrade and failure recovery`, async () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'devn-installer-'));
      try {
        const archive = path.join(root, 'release', archiveName('windows-x64'));
        const hash = await verifyArchive(archive);
        const generated = path.join(root, 'release/install.ps1');
        await verifyArchive(generated);
        expect(await Bun.file(generated).text()).toBe(await renderInstaller(hash));
        // A genuinely older executable allows us to verify upgrade and rollback, not just copying.
        const oldSource = path.join(temp, 'old.ts');
        await Bun.write(oldSource, 'console.log("0.0.0");');
        const oldExe = path.join(temp, 'old.exe');
        const build = Bun.spawnSync([process.execPath, 'build', '--compile', oldSource, '--outfile', oldExe], { stdout: 'pipe', stderr: 'pipe' });
        expect(build.exitCode, build.stderr.toString()).toBe(0);
        const input = JSON.stringify({ temp, archive, installer: generated, version, oldExe, hash });
        const child = Bun.spawn([shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dir, 'verify.ps1')], {
          env: shellEnvironment(), stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe',
        });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code, stdout + '\n' + stderr).toBe(0);
        expect(stdout).toContain('INSTALLER_TESTS_PASSED');
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    }, 180000);
  }

  test('cmd invokes powershell -c with irm | iex in a child process', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'devn-installer-cmd-'));
    const script = await Bun.file(path.join(root, 'release/install.ps1')).text();
    // Serve the exact generated installer over HTTP on loopback. Only its pinned ZIP request is
    // mocked in the child process, so this test exercises the real irm pipeline and cmd quoting.
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(script, { headers: { 'Content-Type': 'text/plain' } }) });
    try {
      const child = Bun.spawn(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dir, 'verify-cmd.ps1')], {
        env: shellEnvironment(),
        stdin: new Blob([JSON.stringify({ temp, root, url: `http://127.0.0.1:${server.port}/install.ps1`, version, archive: path.join(root, 'release', archiveName('windows-x64')) })]),
        stdout: 'pipe', stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, stdout + '\n' + stderr).toBe(0);
      expect(stdout).toContain('CMD_INSTALLER_TEST_PASSED');
    } finally { server.stop(true); fs.rmSync(temp, { recursive: true, force: true }); }
  }, 180000);
});
