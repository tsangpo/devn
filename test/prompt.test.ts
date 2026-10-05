import { testPlatform } from './platform';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './helpers.ts';

async function add(f, answers: [string, string][], command = ['profile', 'add']) {
  let output = '', raw = '';
  let stage = 0;
  const child = Bun.spawn([process.execPath, path.join(f.repo, 'bin/devn'), ...command], {
    env: f.env, cwd: f.project,
    terminal: {
      cols: 100, rows: 30,
      data(terminal, data) {
        raw += new TextDecoder().decode(data);
        output = Bun.stripANSI(raw);
        if (stage < answers.length && output.includes(answers[stage][0].trimEnd())) {
          terminal.write(answers[stage++][1] + testPlatform.enter);
        }
      },
    },
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), Math.min(testPlatform.timeout, 60000));
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
    const answers: [string, string][] = [['Profile JSON URL: ', url], ['Profile name [profile]: ', 'a']];
    if (i) answers.push(['[y/N]: ', 'yes']);
    answers.push(['Trust these gateways to receive your key? [y/N]: ', 'yes'], ['Bifrost key (hidden): ', key]);
    const result = await add(f, answers);
    assert.equal(result.code, 0, result.output);
    assert.equal(result.stage, answers.length);
    assert.ok(!result.output.includes(key));
    assert.ok(!result.output.includes('Open this URL'));
    const file = path.join(f.home, 'devn/config.toml');
    assert.equal(Bun.TOML.parse(await Bun.file(file).text()).profiles.a.key, key);
    testPlatform.assertPrivate(file, 0o600);
    testPlatform.assertPrivate(path.join(f.home, 'devn/profiles/a/profile.json'), 0o600);
    testPlatform.assertPrivate(path.join(f.home, 'devn/profiles/a'), 0o700);
    // Re-adding a profile must keep the project bindings stored in the same file.
    if (!i) assert.equal(f.run(['profile', 'use', 'a']).status, 0);
    else assert.equal(Bun.TOML.parse(await Bun.file(file).text()).projects[f.project], 'a');
  }
  const file = path.join(f.home, 'devn/config.toml');
  const before = await Bun.file(file).text();
  const cancelled = await add(f, [['Profile JSON URL: ', url], ['Profile name [profile]: ', 'a'], ['[y/N]: ', 'n']]);
  assert.equal(cancelled.code, 0);
  assert.match(cancelled.output, /Cancelled/);
  assert.equal(await Bun.file(file).text(), before);
  assert.equal(f.run(['profile', 'use', 'a']).status, 0);
  assert.deepEqual(fs.readdirSync(f.project), []);
});

test('profile add displays authUrl before the hidden key prompt and downloads only once', async t => {
  const f = fixture(t);
  const requests: string[] = [];
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(req) {
    requests.push(new URL(req.url).pathname);
    assert.equal(req.headers.get('authorization'), null);
    return Response.json({ version: 1, baseUrl: 'https://gateway.example.test', authUrl, codex: {}, claude: {} });
  } });
  t.after(() => server.stop(true));
  const authUrl = `http://127.0.0.1:${server.port}/keys?application=devn`;
  const result = await add(f, [
    ['Profile JSON URL: ', `http://127.0.0.1:${server.port}/profile.json`], ['Profile name [profile]: ', 'linked'],
    ['Trust these gateways to receive your key? [y/N]: ', 'yes'],
    ['Bifrost key (hidden): ', 'private-linked-key'],
  ]);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.stage, 4);
  const linkIndex = result.output.indexOf(`Open this URL to get your Bifrost key: ${authUrl}`);
  assert.ok(linkIndex >= 0 && linkIndex < result.output.indexOf('Bifrost key (hidden):'));
  assert.ok(!result.output.includes('private-linked-key'));
  assert.deepEqual(requests, ['/profile.json']);
  assert.equal((await Bun.file(path.join(f.home, 'devn/profiles/linked/profile.json')).json()).authUrl, authUrl);
});

test('profile download or validation failure stops before key input and writes nothing', async t => {
  const f = fixture(t);
  let invalid = false;
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch() {
    return invalid
      ? Response.json({ version: 1, baseUrl: 'https://gateway.example.test', authUrl: 'javascript:alert(1)', codex: {}, claude: {} })
      : new Response('Unavailable', { status: 503 });
  } });
  t.after(() => server.stop(true));
  for (const invalidProfile of [false, true]) {
    invalid = invalidProfile;
    const result = await add(f, [
      ['Profile JSON URL: ', `http://127.0.0.1:${server.port}/profile.json`], ['Profile name [profile]: ', 'failed'],
    ]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, invalid ? /invalid profile/ : /HTTP 503/);
    assert.ok(!result.output.includes('Bifrost key (hidden):'));
    assert.ok(!result.output.includes('Open this URL'));
    assert.equal(await Bun.file(path.join(f.home, 'devn/config.toml')).exists(), false);
    assert.equal(await Bun.file(path.join(f.home, 'devn/profiles/failed/profile.json')).exists(), false);
  }
});

test('profile add always prompts for a name second and accepts filename defaults', async t => {
  const f = fixture(t);
  let requests = 0;
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch() {
    requests++;
    return Response.json({ version: 1, baseUrl: 'https://gateway.example.test', codex: {}, claude: {} });
  } });
  t.after(() => server.stop(true));
  for (const [filename, name] of [
    ['customer-a.json', 'customer-a'],
    ['nested/customer-b.JSON?token=ignored.json', 'customer-b'],
    ['customer%2Dc%2Ejson', 'customer-c'],
  ]) {
    const url = `http://127.0.0.1:${server.port}/${filename}`;
    const result = await add(f, [
      ['Profile JSON URL: ', url], ['Profile name [' + name + ']: ', ''],
      ['Trust these gateways to receive your key? [y/N]: ', 'yes'],
      ['Bifrost key (hidden): ', 'test-key'],
    ]);
    assert.equal(result.code, 0, result.output);
    assert.equal(result.stage, 4);
    assert.ok(result.output.indexOf('Profile JSON URL:') < result.output.indexOf('Profile name ['));
    const file = path.join(f.home, 'devn/config.toml');
    assert.equal(Bun.TOML.parse(await Bun.file(file).text()).profiles[name].url, url);
    const before = await Bun.file(file).text();
    const count = requests;
    const cancelled = await add(f, [
      ['Profile JSON URL: ', url], ['Profile name [' + name + ']: ', ''],
      [`Update profile ${name} URL and key? [y/N]: `, 'n'],
    ]);
    assert.equal(cancelled.code, 0, cancelled.output);
    assert.equal(cancelled.stage, 3);
    assert.ok(!cancelled.output.includes('Bifrost key'));
    assert.equal(requests, count);
    assert.equal(await Bun.file(file).text(), before);
  }
});

test('profile add requires a manual name when the URL has no valid filename default', async t => {
  const f = fixture(t);
  f.addProfile('manual');
  f.init('manual');
  const file = path.join(f.home, 'devn/config.toml');
  const before = await Bun.file(file).text();
  for (const filename of [
    '', 'folder/', 'profile', 'profile.txt', '.json', 'bad%20name.json',
    '%2Fname.json', '%ZZ.json', '__proto__.json', 'constructor.json',
    'prototype.json', 'a'.repeat(65) + '.json',
  ]) {
    const url = 'https://config.example.test/' + filename;
    const result = await add(f, [
      ['Profile JSON URL: ', url], ['Profile name: ', 'manual'],
      ['Update profile manual URL and key? [y/N]: ', 'n'],
    ]);
    assert.equal(result.code, 0, result.output);
    assert.equal(result.stage, 3);
    assert.ok(result.output.indexOf('Profile JSON URL:') < result.output.indexOf('Profile name:'));
    assert.ok(!result.output.includes('Bifrost key'));
  }
  for (const name of ['', 'bad name']) {
    const result = await add(f, [
      ['Profile JSON URL: ', 'https://config.example.test/profile'], ['Profile name: ', name],
    ]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Invalid profile name/);
    assert.ok(!result.output.includes('Bifrost key'));
  }
  assert.equal(await Bun.file(file).text(), before);
});

test('profile add rejects invalid URLs before asking for a name or key', async t => {
  const f = fixture(t);
  for (const url of ['not-a-url', 'http://config.example.test/profile.json']) {
    const result = await add(f, [['Profile JSON URL: ', url]]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /HTTPS/);
    assert.ok(!result.output.includes('Profile name'));
    assert.ok(!result.output.includes('Bifrost key'));
  }
  assert.equal(await Bun.file(path.join(f.home, 'devn/config.toml')).exists(), false);
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
    ['Profile JSON URL: ', `http://127.0.0.1:${server.port}/profile.json`],
    ['Profile name [profile]: ', 'new'],
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
