import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { powershell } from '../../src/platform/windows/system';

export function acl(file: string): { protected: boolean; sids: string[]; user: string } {
  return JSON.parse(powershell(`
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$a = Get-Acl -LiteralPath $p.path
$r = @($a.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
@{ protected = $a.AreAccessRulesProtected; sids = @($r | ForEach-Object { $_.IdentityReference.Value });
user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Compress
`, { path: file }));
}

export const windowsTests = {
  posix: false,
  enter: '\r',
  operationTimeout: 20000,
  timeout: 180000,
  entry: (file: string) => [process.execPath, file],
  executableName: (name: string) => name + '.exe',
  writeExecutable(file: string, source: string) {
    const script = file + '.ts';
    fs.writeFileSync(script, source);
    const result = Bun.spawnSync([process.execPath, 'build', '--compile', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', script, '--outfile', file + '.exe'], { stdout: 'pipe', stderr: 'pipe' });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    fs.unlinkSync(script);
  },
  assertPrivate(file: string, _mode: number) {
    const value = acl(file);
    assert.equal(value.protected, true);
    assert.deepEqual(value.sids.sort(), [value.user, 'S-1-5-18'].sort());
  },
  linkDirectory(target: string, link: string) { fs.symlinkSync(target, link, 'junction'); },
  environment() {
    // Windows environment names are case-insensitive. Avoid passing both PATH and Path.
    const env = { ...process.env };
    const key = Object.keys(env).find(k => k.toLowerCase() === 'path');
    const value = key ? env[key] : '';
    if (key) delete env[key];
    return { ...env, PATH: value };
  },
};
