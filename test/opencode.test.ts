import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, read, write } from './helpers';
import { testPlatform } from './platform';
import { validateProfile, gatewayOrigins, modelIds } from '../src/registry';
import { openCodeArgs } from '../src/clients/opencode-runtime';
import example from '../profiles/example.json';

function mock(f: ReturnType<typeof fixture>, name = 'opencode', version = '2.0.21') {
  testPlatform.writeExecutable(path.join(f.bin, name), `
if (process.argv[2] === '--version') { console.log(${JSON.stringify(version)}); process.exit(0); }
const fs = require('node:fs'), path = require('node:path');
fs.writeFileSync(process.env.TEST_CAPTURE, JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(), env: process.env,
  config: JSON.parse(fs.readFileSync(path.join(process.env.OPENCODE_CONFIG_DIR, 'opencode.json'), 'utf8'))
}));
if (process.env.TEST_WAIT) { process.on('SIGINT', () => process.exit(130)); console.log('READY'); setInterval(() => {}, 1000); }
else { console.log('TOOL OUTPUT'); process.exit(Number(process.env.TEST_EXIT || 0)); }
`);
}

test('OpenCode profile validates native model metadata without accepting executable or connection fields', () => {
  validateProfile(structuredClone(example));
  const input = structuredClone(example);
  input.opencode = { model: 'coding', models: { coding: {}, reasoning: {} } } as typeof input.opencode;
  const profile = validateProfile(input);
  assert.deepEqual(modelIds(profile, 'opencode'), ['bifrost/coding', 'bifrost/reasoning']);
  assert.equal(gatewayOrigins(profile).opencode, 'https://bifrost.example.invalid');
  for (const change of [
    p => { p.opencode = {}; }, p => { p.opencode.models = {}; },
    p => { p.opencode.model = 'missing'; }, p => { p.opencode.models['gpt-6.1-sol'].package = 'evil'; },
    p => { p.opencode.models['gpt-6.1-sol'].settings = { baseURL: 'https://evil.test' }; },
    p => { p.opencode.models['gpt-6.1-sol'].headers = { Authorization: 'evil' }; },
    p => { p.opencode.models['gpt-6.1-sol'].limit.context = 0; },
    p => { p.opencode.models['gpt-6.1-sol'].capabilities = { tools: 'true', input: ['text'], output: ['text'] }; },
    p => { p.opencode.models['gpt-6.1-sol'].cost = { input: -1, output: 1 }; },
    p => { p.opencode.models['gpt-6.1-sol'].name = '{file:/tmp/secret}'; },
    p => { p.baseUrl = 'https://gateway.example.test/{file:/tmp/secret}'; },
    p => { p.opencode.models['gpt-6.1-sol'].modelID = 'bad#variant'; },
    p => { p.opencode.models.constructor = {}; },
    p => { p.opencode.baseUrl = 'http://remote.example.test'; },
  ]) {
    const invalid: any = structuredClone(example); change(invalid);
    assert.throws(() => validateProfile(invalid));
  }
  const old: any = structuredClone(example); delete old.opencode;
  assert.equal(validateProfile(old).opencode, undefined);
  assert.equal(gatewayOrigins(validateProfile(old)).opencode, undefined);
});

test('OpenCode argument handling separates option values from routing overrides', () => {
  const profile = validateProfile(example);
  const prompt = 'spaces, $literal, "quotes", 中文\nnext line';
  assert.deepEqual(openCodeArgs(['run', '-mbifrost/gpt-6.1-sol', '--', prompt], profile).args,
    ['run', '--standalone', '--model', 'bifrost/gpt-6.1-sol', '--', prompt]);
  assert.deepEqual(openCodeArgs(['--prompt', '--server'], profile).args, ['--standalone', '--prompt', '--server']);
  assert.deepEqual(openCodeArgs(['--model=bifrost/gpt-6.1-sol'], profile), { args: ['--standalone'], model: 'bifrost/gpt-6.1-sol' });
  assert.deepEqual(openCodeArgs(['session', 'list', '--format', 'json'], profile).args, ['session', 'list', '--standalone', '--format', 'json']);
  assert.deepEqual(openCodeArgs(['mcp', 'add', 'local', '--', 'bun', 'server.ts'], profile).args, ['mcp', 'add', '--global', 'local', '--', 'bun', 'server.ts']);
  assert.throws(() => openCodeArgs(['mcp', 'add', 'local', '--global=false'], profile));
  for (const args of [['service', 'start'], ['serve'], ['pair'], ['api', 'GET', '/api/session'], ['/tmp'], ['--', '/tmp'], ['run', '--server=x'], ['run', '--directory', '/tmp'], ['run', '--no-standalone'], ['run', '--standalone=false'], ['run', '--model', 'other/coding'], ['run', '-mmissing']]) {
    assert.throws(() => openCodeArgs(args, profile));
  }
});

test('OpenCode launches with private paths, managed gateway, preserved arguments and exit status', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']); mock(f);
  const prompt = 'spaces and $literal "quotes" 中文';
  const result = f.run(['opencode', 'run', '--model', 'bifrost/gpt-6.1-sol', prompt], { env: {
    ...f.env, TEST_EXIT: '7', OPENCODE_CONFIG_CONTENT: 'secret override', OPENCODE_DB: '/external.db',
    OPENCODE_CONFIG_DIR: '/external', OPENCODE_CONFIG_PROJECT_DISABLE: '0', OPENCODE_TEST_HOME: '/external',
    OPENAI_API_KEY: 'external', ANTHROPIC_AUTH_TOKEN: 'external', OPENCODE_DISABLE_MOUSE: '1',
  } });
  assert.equal(result.status, 7, result.stderr);
  const capture = read(f.capture), dir = path.join(f.home, 'devn/profiles/a/opencode');
  assert.deepEqual(capture.args, ['run', '--standalone', '--model', 'bifrost/gpt-6.1-sol', prompt]);
  assert.equal(capture.cwd, f.project);
  assert.equal(capture.env.OPENCODE_CONFIG_DIR, dir);
  assert.equal(capture.env.OPENCODE_CONFIG_PROJECT_DISABLE, '1');
  for (const key of ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_DB', 'OPENCODE_TEST_HOME', 'OPENAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) assert.equal(capture.env[key], undefined);
  for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR', 'TEMP']) assert.ok(capture.env[key].startsWith(dir + path.sep));
  assert.equal(capture.env.HOME, f.env.HOME);
  assert.equal(capture.env.OPENCODE_DISABLE_MOUSE, '1');
  assert.equal(capture.config.providers.bifrost.settings.baseURL, 'https://a.example.test/openai/v1');
  assert.equal(capture.config.providers.bifrost.settings.apiKey, 'secret-a');
  assert.deepEqual(capture.config.providers.bifrost.models, f.a.opencode.models);
  assert.deepEqual(read(path.join(dir, 'service.json')), { disabled: true });
  assert.ok(!result.stdout.includes('secret-a') && !result.stderr.includes('secret-a'));
  testPlatform.assertPrivate(path.join(dir, 'opencode.json'), 0o600);
  testPlatform.assertPrivate(dir, 0o700);
  assert.deepEqual(f.run(['opencode', 'models']).stdout.trim().split(/\r?\n/), modelIds(f.a, 'opencode')!.sort());
});

test('OpenCode refresh replaces owned provider settings and preserves local customization', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']); mock(f);
  f.a.opencode.models.second = { name: 'Second', modelID: 'upstream/second' };
  const profile = path.join(f.home, 'devn/profiles/a/profile.json'); write(profile, f.a);
  assert.equal(f.run(['opencode']).status, 0);
  const file = path.join(f.home, 'devn/profiles/a/opencode/opencode.json');
  const config = read(file);
  config.model = 'bifrost/second'; config.agents = { review: { description: 'Local agent' } };
  config.mcp = { servers: {} }; config.providers.bifrost.settings.baseURL = 'https://wrong.test';
  config.providers.bifrost.headers = { Authorization: 'old-secret' };
  config.providers.bifrost.package = '@opencode/ai/providers/openai-compatible';
  config.experimental.policies.push({ action: 'permission', resource: 'shell:git push *', effect: 'deny' });
  write(file, config); f.init('a', 'rotated-key');
  assert.equal(f.run(['opencode']).status, 0);
  let next = read(file);
  assert.equal(next.model, 'bifrost/second'); assert.deepEqual(next.agents, config.agents);
  assert.deepEqual(next.mcp, config.mcp);
  assert.equal(next.providers.bifrost.headers, undefined);
  assert.equal(next.providers.bifrost.package, '@opencode/ai/providers/openai/responses');
  assert.equal(next.providers.bifrost.settings.apiKey, 'rotated-key');
  assert.equal(next.experimental.policies.length, 3);
  delete f.a.opencode.models.second; f.a.opencode.baseUrl = 'https://a.example.test/updated/v1'; write(profile, f.a);
  const result = f.run(['opencode']); assert.equal(result.status, 0, result.stderr);
  next = read(file); assert.equal(next.model, 'bifrost/gpt-6.1-sol');
  assert.equal(next.providers.bifrost.models.second, undefined);
  assert.equal(next.providers.bifrost.settings.baseURL, f.a.opencode.baseUrl);
  assert.match(result.stderr, /no longer listed/);
  assert.equal(f.run(['opencode', '--model=bifrost/gpt-6.1-sol']).status, 0);
  assert.deepEqual(JSON.parse(read(f.capture).env.OPENCODE_CONFIG_CONTENT), { model: 'bifrost/gpt-6.1-sol' });
});

test('OpenCode accepts every v2 release, falls back to opencode2, and rejects other majors', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  mock(f, 'opencode', '1.18.0'); mock(f, 'opencode2');
  assert.equal(f.run(['opencode']).status, 0);
  for (const version of ['2.0.0', '2.0.20', '2.1.0']) {
    mock(f, 'opencode', version);
    mock(f, 'opencode2', '3.0.0');
    const result = f.run(['opencode']);
    assert.equal(result.status, 0, result.stderr);
  }
  mock(f, 'opencode', '1.18.0');
  mock(f, 'opencode2', '2.0.0');
  assert.equal(f.run(['opencode']).status, 0);
  mock(f, 'opencode2', '3.0.0');
  const env = { ...f.env, PATH: f.bin };
  const unsupported = f.run(['opencode'], { env });
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /OpenCode v2 is required/);
  fs.unlinkSync(path.join(f.bin, testPlatform.executableName('opencode')));
  fs.unlinkSync(path.join(f.bin, testPlatform.executableName('opencode2')));
  assert.match(f.run(['opencode'], { env }).stderr, /official @opencode\/cli/);
});

test('OpenCode rejects conflicting and malformed files without leaking or overwriting them', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']); mock(f);
  assert.equal(f.run(['opencode']).status, 0);
  const file = path.join(f.home, 'devn/profiles/a/opencode/opencode.json');
  const broken = '{"apiKey":"VERY-SECRET",'; fs.writeFileSync(file, broken);
  const result = f.run(['opencode']); assert.notEqual(result.status, 0);
  assert.ok(!result.stderr.includes('VERY-SECRET')); assert.equal(fs.readFileSync(file, 'utf8'), broken);
  write(file, {}); write(file + 'c', {});
  assert.match(f.run(['opencode']).stderr, /opencode.jsonc/);
  fs.unlinkSync(file + 'c');
  const plugins = path.join(f.project, '.opencode/plugins'); fs.mkdirSync(plugins, { recursive: true });
  fs.writeFileSync(path.join(plugins, 'must-not-load.js'), 'throw new Error("ambient plugin executed");');
  assert.match(f.run(['opencode']).stderr, /Project TUI plugins/);
  assert.equal(f.run(['opencode', 'run', 'hello']).status, 0);
});

test('OpenCode is optional for old profiles and separates data across bindings', t => {
  const f = fixture(t); f.init('a'); f.init('b'); mock(f);
  f.run(['profile', 'use', 'a']); assert.equal(f.run(['opencode']).status, 0);
  const first = read(f.capture).env;
  f.run(['profile', 'use', 'b']); assert.equal(f.run(['opencode']).status, 0);
  const second = read(f.capture).env;
  for (const key of ['OPENCODE_CONFIG_DIR', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']) assert.notEqual(first[key], second[key]);
  delete f.b.opencode; write(path.join(f.home, 'devn/profiles/b/profile.json'), f.b); f.init('b');
  assert.equal(f.run(['codex']).status, 0);
  assert.match(f.run(['opencode']).stderr, /Add an opencode section/);
});

test('OpenCode receives forwarded terminal signals', { skip: !testPlatform.posix }, async t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']); mock(f);
  const child = f.start(['opencode', 'run', 'hello'], { env: { ...f.env, TEST_WAIT: '1' } });
  t.after(() => child.kill('SIGKILL'));
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  child.stdout.on('data', chunk => { if (chunk.toString().includes('READY')) child.kill('SIGINT'); });
  const code = await new Promise(resolve => child.on('exit', resolve));
  clearTimeout(timer); assert.equal(code, 130);
});
