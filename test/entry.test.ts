import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, read } from './helpers.ts';

test('executable entry runs without Git checkout, invoking Git, or creating a legacy directory', t => {
  const f = fixture(t);
  const marker = path.join(f.dir, 'git-called');
  fs.writeFileSync(path.join(f.bin, 'git'), `#!${process.execPath}
await Bun.write(${JSON.stringify(marker)}, 'called');
process.exit(99);
`, { mode: 0o755 });
  const entry = path.join(f.repo, 'bin/devn');
  assert.equal(fs.existsSync(path.join(f.repo, '.git')), false);
  for (const args of [['--help'], ['profile', 'list']]) {
    const result = Bun.spawnSync([entry, ...args], {
      cwd: f.project, env: { ...f.env, HOME: f.home }, stdout: 'pipe', stderr: 'pipe',
    });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.toString(), '');
  }
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.join(f.home, '.devn')), false);
  assert.equal(fs.existsSync(path.join(f.home, '.update.lock')), false);
});

test('symlinked executable preserves project cwd, arguments, and tool exit status', t => {
  const f = fixture(t);
  f.init('a');
  assert.equal(f.run(['profile', 'use', 'a']).status, 0);
  const entry = path.join(f.bin, 'devn');
  fs.symlinkSync(path.join(f.repo, 'bin/devn'), entry);
  const prompt = 'argument with spaces and $literal';
  const result = Bun.spawnSync([entry, 'codex', 'exec', prompt], {
    cwd: f.project, env: { ...f.env, TEST_EXIT: '7' }, stdout: 'pipe', stderr: 'pipe',
  });
  assert.equal(result.exitCode, 7, result.stderr.toString());
  assert.equal(read(f.capture).cwd, f.project);
  assert.ok(read(f.capture).args.includes(prompt));
});
