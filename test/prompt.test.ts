import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './helpers.ts';

async function add(f, answers: [string, string][], command = ['profile', 'add']) {
  let output = '';
  let stage = 0;
  const child = Bun.spawn([process.execPath, path.join(f.repo, 'bin/devn'), ...command], {
    env: f.env, cwd: f.project,
    terminal: {
      cols: 100, rows: 30,
      data(terminal, data) {
        output += new TextDecoder().decode(data);
        if (stage < answers.length && output.includes(answers[stage][0])) {
          terminal.write(answers[stage++][1] + '\n');
        }
      },
    },
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  try { return { code: await child.exited, output, stage }; }
  finally { clearTimeout(timer); child.terminal.close(); }
}

test('profile add hides keys, fetches without authentication, confirms updates and preserves data', async t => {
  const f = fixture(t);
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(req) {
    assert.equal(req.headers.get('authorization'), null);
    return Response.json({ version: 1, baseUrl: 'https://gateway.example.test', codex: {}, claude: {} });
  } });
  t.after(() => server.stop(true));
  const url = `http://127.0.0.1:${server.port}/profile.json`;
  for (let i = 0; i < 2; i++) {
    const key = `private-prompt-key-${i}-"\\秘密`;
    const answers: [string, string][] = [['Profile name: ', 'a']];
    if (i) answers.push(['[y/N]: ', 'yes']);
    answers.push(['Profile JSON URL: ', url], ['Bifrost key (hidden): ', key], ['Trust these gateways to receive your key? [y/N]: ', 'yes']);
    const result = await add(f, answers);
    assert.equal(result.code, 0, result.output);
    assert.equal(result.stage, answers.length);
    assert.ok(!result.output.includes(key));
    const file = path.join(f.home, 'devn/config.toml');
    assert.equal(Bun.TOML.parse(await Bun.file(file).text()).profiles.a.key, key);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(f.home, 'devn/profiles/a/profile.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(f.home, 'devn/profiles/a')).mode & 0o777, 0o700);
    // Re-adding a profile must keep the project bindings stored in the same file.
    if (!i) assert.equal(f.run(['profile', 'use', 'a']).status, 0);
    else assert.equal(Bun.TOML.parse(await Bun.file(file).text()).projects[f.project], 'a');
  }
  const file = path.join(f.home, 'devn/config.toml');
  const before = await Bun.file(file).text();
  const cancelled = await add(f, [['Profile name: ', 'a'], ['[y/N]: ', 'n']]);
  assert.equal(cancelled.code, 0);
  assert.match(cancelled.output, /Cancelled/);
  assert.equal(await Bun.file(file).text(), before);
  assert.equal(f.run(['profile', 'use', 'a']).status, 0);
  assert.deepEqual(fs.readdirSync(f.project), []);
});

test('profile remove requires confirmation, preserves history by default, and purges explicitly', async t => {
  const f = fixture(t);
  f.init('a'); f.run(['profile', 'use', 'a']); f.run(['codex']); f.run(['claude']);
  const history = path.join(f.home, 'devn/profiles/a/codex/history.jsonl');
  await Bun.write(history, 'keep history');
  const cancelled = await add(f, [['Type a to confirm removal: ', 'no']], ['profile', 'remove', 'a']);
  assert.equal(cancelled.code, 0);
  assert.match(f.run(['profile', 'list']).stdout, /a/);
  const removed = await add(f, [['Type a to confirm removal: ', 'a']], ['profile', 'remove', 'a']);
  assert.equal(removed.code, 0, removed.output);
  assert.equal(await Bun.file(history).text(), 'keep history');
  assert.notEqual(f.run(['codex']).status, 0);
  assert.equal(Bun.TOML.parse(await Bun.file(path.join(f.home, 'devn/config.toml')).text()).projects[f.project], 'a');
  const purged = await add(f, [['Type a to confirm removal: ', 'a']], ['profile', 'remove', 'a', '--purge']);
  assert.equal(purged.code, 0, purged.output);
  assert.equal(await Bun.file(history).exists(), false);
});

test('declining gateway approval does not register or replace a profile', async t => {
  const f = fixture(t);
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch() {
    return Response.json({ version: 1, baseUrl: 'https://gateway.example.test', codex: {}, claude: {} });
  } });
  t.after(() => server.stop(true));
  const result = await add(f, [
    ['Profile name: ', 'new'],
    ['Profile JSON URL: ', `http://127.0.0.1:${server.port}/profile.json`],
    ['Bifrost key (hidden): ', 'private-test-key'],
    ['Trust these gateways to receive your key? [y/N]: ', 'n'],
  ]);
  assert.notEqual(result.code, 0);
  assert.ok(!result.output.includes('private-test-key'));
  assert.equal(await Bun.file(path.join(f.home, 'devn/config.toml')).exists(), false);
  assert.match(result.output, /gateway.example.test/);
});

test('password prompt is written only after raw mode and key handler are ready', async t => {
  const f = fixture(t);
  await Bun.write(path.join(f.repo, 'bin/devn'), `
import { password } from '../src/prompts.ts';
const write = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  if (chunk === 'Bifrost key (hidden): ' &&
      (!process.stdin.isRaw || process.stdin.listenerCount('keypress') === 0)) process.exit(91);
  return write(chunk, ...args);
};
const key = await password();
if (key !== 'readiness-test-key' || process.stdin.isRaw) process.exit(92);
`);
  const result = await add(f, [['Bifrost key (hidden): ', 'readiness-test-key']], []);
  assert.equal(result.code, 0);
  assert.equal(result.stage, 1);
  assert.ok(!result.output.includes('readiness-test-key'));
});
