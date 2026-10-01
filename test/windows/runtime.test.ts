import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireLock } from '../../src/files';
import { fixture } from '../helpers';
import { testPlatform, prependPath } from '../platform';
import { windows } from '../../src/platform/windows';
import { resolveCommand } from '../../src/platform/windows/process';
import { powershell, powershellCommand } from '../../src/platform/windows/system';
import { replaceFile } from '../../src/platform/windows/files';
import { acl } from './fixtures';

describe('Windows runtime', { skip: testPlatform.posix }, () => {
  test('configuration precedence, private ACLs, and failed protection do not leak writes', async t => {
    const f = fixture(t);
    const script = path.join(f.dir, 'probe.ts');
    await Bun.write(script, `import {configHome} from ${JSON.stringify(path.join(f.repo, 'src/files.ts'))}; console.log(configHome());`);
    const env = { ...f.env, XDG_CONFIG_HOME: '', LOCALAPPDATA: f.home };
    const result = Bun.spawnSync([process.execPath, script], { env, stdout: 'pipe', stderr: 'pipe' });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString().trim(), path.join(f.home, 'devn'));
    env.XDG_CONFIG_HOME = path.join(f.dir, 'override');
    const override = Bun.spawnSync([process.execPath, script], { env, stdout: 'pipe' });
    assert.equal(override.stdout.toString().trim(), path.join(env.XDG_CONFIG_HOME, 'devn'));
    const file = path.join(f.dir, 'private', 'key.txt');
    try { windows.atomicWrite(file, 'dummy-key'); }
    catch (error: any) { throw new Error(String(error.cause || error.message)); }
    testPlatform.assertPrivate(file, 0o600);
    testPlatform.assertPrivate(path.dirname(file), 0o700);
    powershell(`
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$a = Get-Acl -LiteralPath $p.path
$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
  [Security.Principal.SecurityIdentifier]::new('S-1-1-0'), 'Read', 'Allow'))
Set-Acl -LiteralPath $p.path -AclObject $a
`, { path: file });
    assert.ok(acl(file).sids.includes('S-1-1-0'));
    windows.privateFile(file);
    testPlatform.assertPrivate(file, 0o600);
    const oldRoot = process.env.SystemRoot;
    try {
      process.env.SystemRoot = path.join(f.dir, 'missing-system');
      assert.throws(() => windows.atomicWrite(file, 'replacement-secret'));
      assert.equal(fs.readFileSync(file, 'utf8'), 'dummy-key');
    } finally { process.env.SystemRoot = oldRoot; }
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['key.txt']);
    const link = path.join(f.dir, 'junction');
    fs.symlinkSync(path.dirname(file), link, 'junction');
    assert.throws(() => windows.atomicWrite(path.join(link, 'key.txt'), 'bad'), /junction/);
  });

  test('rename retries transient sharing violations and preserves old data on exhaustion', async t => {
    const f = fixture(t);
    const target = path.join(f.dir, 'target.txt');
    const temp = path.join(f.dir, 'replacement.tmp');
    for (const holdMs of [100, 2000]) {
      fs.writeFileSync(target, 'original'); fs.writeFileSync(temp, 'replacement');
      const ready = path.join(f.dir, 'ready'); fs.rmSync(ready, { force: true });
      const child = Bun.spawn(powershellCommand(`
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$f = [IO.File]::Open($p.path, 'Open', 'Read', 'Read')
try { [IO.File]::WriteAllText($p.ready, 'ready'); Start-Sleep -Milliseconds $p.hold }
finally { $f.Dispose() }
`), { stdin: Buffer.from(JSON.stringify({ path: target, ready, hold: holdMs })), stdout: 'pipe', stderr: 'pipe' });
      try {
        const deadline = Date.now() + 10000;
        while (!fs.existsSync(ready) && Date.now() < deadline) await Bun.sleep(10);
        assert.ok(fs.existsSync(ready), 'holder did not acquire the file');
        if (holdMs === 100) {
          replaceFile(temp, target);
          assert.equal(fs.readFileSync(target, 'utf8'), 'replacement');
        } else {
          assert.throws(() => replaceFile(temp, target));
          assert.equal(fs.readFileSync(target, 'utf8'), 'original');
          assert.equal(fs.readFileSync(temp, 'utf8'), 'replacement');
        }
      } finally { await child.exited; }
    }
  });

  test('live locks serialize writers and dead-owner locks can be recovered', async t => {
    const f = fixture(t);
    const dir = path.join(f.dir, 'locks', 'profile.lock');
    const release = await acquireLock(dir);
    let entered = false;
    const next = acquireLock(dir).then(unlock => { entered = true; return unlock; });
    await Bun.sleep(100);
    assert.equal(entered, false);
    release();
    (await next)();
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: 2147483647, host: os.hostname(), token: 'dead-owner' }));
    const recovered = await acquireLock(dir, 5000);
    recovered();
    assert.equal(fs.existsSync(dir), false);
  });

  test('official npm JS and EXE entries preserve arguments without executing wrappers', async t => {
    const f = fixture(t);
    const args = ['', '中文 空格', 'line1\nline2', '"quoted"', 'C:\\path with spaces\\', '%PATH% ! ^ & | < >', '{"model":"x"}'];
    for (const layout of ['global', 'local']) {
      const root = path.join(f.dir, layout, 'node_modules');
      const bin = layout === 'global' ? path.dirname(root) : path.join(root, '.bin');
      fs.mkdirSync(bin, { recursive: true });
      const pkg = path.join(root, '@openai', 'codex'); fs.mkdirSync(pkg, { recursive: true });
      await Bun.write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@openai/codex', bin: { codex: 'cli.mjs' } }));
      await Bun.write(path.join(pkg, 'cli.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
      await Bun.write(path.join(bin, 'codex.cmd'), '@echo WRAPPER_MUST_NOT_RUN\r\nexit /b 99');
      const env = prependPath(bin);
      const argv = resolveCommand('codex', args, env);
      const result = Bun.spawnSync(argv, { env, stdout: 'pipe', stderr: 'pipe' });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(JSON.parse(result.stdout.toString()), args);
      const onlyBin = { ...env, PATH: bin };
      assert.throws(() => resolveCommand('codex', args, onlyBin), /Node.js/);
      await Bun.write(path.join(pkg, 'package.json'), JSON.stringify({ name: 'unrelated', bin: { codex: 'cli.mjs' } }));
      assert.throws(() => resolveCommand('codex', args, env), /official npm/);
    }
    const bin = path.join(f.dir, 'native'); fs.mkdirSync(bin);
    testPlatform.writeExecutable(path.join(bin, 'claude'), 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(7)');
    const env = { ...f.env, PATH: bin };
    const result = Bun.spawnSync(resolveCommand('claude', args, env), { env, stdout: 'pipe' });
    assert.equal(result.exitCode, 7);
    assert.deepEqual(JSON.parse(result.stdout.toString()), args);
    assert.throws(() => resolveCommand('codex', [], env), /not installed/);
    await Bun.write(path.join(bin, 'codex.cmd'), '@echo unsupported');
    assert.throws(() => resolveCommand('codex', [], env), /official npm/);
    // The same npm layout can point at a native binary instead of JavaScript.
    const pkg = path.join(bin, 'node_modules', '@anthropic-ai', 'claude-code'); fs.mkdirSync(pkg, { recursive: true });
    fs.renameSync(path.join(bin, 'claude.exe'), path.join(pkg, 'cli.exe'));
    await Bun.write(path.join(bin, 'claude.cmd'), '@echo WRAPPER_MUST_NOT_RUN');
    await Bun.write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', bin: { claude: 'cli.exe' } }));
    assert.equal(Bun.spawnSync(resolveCommand('claude', args, env), { env }).exitCode, 7);
  });

  test('real paths preserve bindings across case and junction aliases and reject name collisions', t => {
    const f = fixture(t); f.init('a'); f.init('b');
    assert.equal(f.run(['profile', 'use', 'a']).status, 0);
    const alternate = f.project.toUpperCase();
    assert.equal(windows.projectPath(alternate), windows.projectPath(f.project));
    assert.match(f.run(['profile', 'list'], { cwd: alternate }).stdout, /\* a/);
    assert.equal(f.run(['profile', 'unbind'], { cwd: alternate }).status, 0);
    const file = path.join(f.home, 'devn/config.toml');
    const config: any = Bun.TOML.parse(fs.readFileSync(file, 'utf8'));
    config.projects = { [f.project]: 'a', [alternate]: 'b' };
    fs.writeFileSync(file, Bun.TOML.stringify(config));
    assert.match(f.run(['profile', 'list']).stderr, /Conflicting project bindings/);
    config.projects = {}; config.profiles.A = config.profiles.a;
    fs.writeFileSync(file, Bun.TOML.stringify(config));
    assert.match(f.run(['profile', 'list']).stderr, /same directory/);
    for (const name of ['CON', 'nul', 'COM1', 'lpt9']) assert.equal(windows.validProfileName(name), false);
    const unc = '\\\\server\\share\\中文\\project';
    assert.deepEqual(Bun.TOML.parse(Bun.TOML.stringify({ projects: { [unc]: 'a' } })).projects, { [unc]: 'a' });
    assert.equal(path.win32.dirname('\\\\server\\share\\'), '\\\\server\\share\\');
  });
});
