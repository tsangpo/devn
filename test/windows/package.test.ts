import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from '../helpers';
import { testPlatform } from '../platform';
import { powershell as systemPowershell } from '../../src/platform/windows/system';
import { version } from '../../package.json';

function powershell(script: string, data: unknown): string {
  try { return systemPowershell(script, data); }
  catch (error: any) { throw new Error(String(error.cause || error.message)); }
}

describe('Windows npm entry', { skip: testPlatform.posix }, () => {
  test('npm-installed shim runs in both PowerShell and cmd', async t => {
    const f = fixture(t);
    const tarball = path.join(f.dir, 'devn.tgz');
    const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', tarball], { cwd: f.repo, stdout: 'pipe', stderr: 'pipe' });
    assert.equal(packed.exitCode, 0, packed.stderr.toString());
    const output = powershell(`
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
Set-Location -LiteralPath $p.project
& npm.cmd install --ignore-scripts --no-audit --no-fund $p.archive | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
$entry = Join-Path $p.project 'node_modules\\.bin\\devn.cmd'
$a = & $entry --version
if ($LASTEXITCODE -ne 0) { throw 'PowerShell entry failed' }
$b = & $env:ComSpec /d /s /c ('""' + $entry + '" --version"')
if ($LASTEXITCODE -ne 0) { throw 'cmd entry failed' }
ConvertTo-Json -InputObject @($a, $b) -Compress
`, { project: f.project, archive: tarball });
    assert.deepEqual(JSON.parse(output), [version, version]);
  });
});
