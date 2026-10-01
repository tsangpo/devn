import { validateProfile } from '../src/registry';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { parse, stringify } = Bun.TOML;
const { fixture, write, read } = require('./helpers.ts');

const projects = f => Bun.TOML.parse(fs.readFileSync(path.join(f.home, 'devn/config.toml'), 'utf8')).projects;

test('binding, ancestor inheritance, nested override, and paths with spaces', t => {
  const f = fixture(t);
  assert.match(f.run(['codex']).stderr, /No project binding/);
  assert.match(f.run(['profile', 'use', 'a']).stderr, /Unknown profile/);
  f.init('a'); f.init('b');
  assert.equal(f.run(['profile', 'use', 'a']).status, 0);
  assert.deepEqual(projects(f), { [f.project]: 'a' });
  assert.deepEqual(fs.readdirSync(f.project), []);
  assert.equal(fs.statSync(path.join(f.home, 'devn/config.toml')).mode & 0o777, 0o600);
  const sub = path.join(f.project, 'packages', 'app'); fs.mkdirSync(sub, { recursive: true });
  assert.equal(f.run(['codex', 'exec', 'a prompt with spaces'], { cwd: sub }).status, 0);
  assert.equal(read(f.capture).cwd, sub);
  assert.equal(read(f.capture).codex, path.join(f.home, 'devn/profiles/a/codex'));
  assert.equal(f.run(['profile', 'use', 'b'], { cwd: sub }).status, 0);
  assert.deepEqual(projects(f), { [f.project]: 'a', [sub]: 'b' });
  assert.equal(f.run(['claude', '-p', 'hello'], { cwd: sub }).status, 0);
  assert.equal(read(f.capture).claude, path.join(f.home, 'devn/profiles/b/claude'));
  assert.match(f.run(['profile', 'list'], { cwd: sub }).stdout, /\* b/);
  assert.equal(f.run(['codex'], { cwd: f.project }).status, 0);
  assert.equal(read(f.capture).codex, path.join(f.home, 'devn/profiles/a/codex'));
});

test('unbind removes only the exact directory, and symlinks resolve to the real path', t => {
  const f = fixture(t); f.init('a');
  const sub = path.join(f.project, 'sub'); fs.mkdirSync(sub);
  f.run(['profile', 'use', 'a']);
  const inherited = f.run(['profile', 'unbind'], { cwd: sub });
  assert.notEqual(inherited.status, 0);
  assert.match(inherited.stderr, /inherits/);
  assert.deepEqual(projects(f), { [f.project]: 'a' });
  const link = path.join(f.dir, 'link'); fs.symlinkSync(f.project, link);
  assert.equal(f.run(['codex'], { cwd: link }).status, 0);
  assert.equal(f.run(['profile', 'unbind'], { cwd: link }).status, 0);
  assert.deepEqual(projects(f), {});
  assert.match(f.run(['codex']).stderr, /No project binding/);
});

test('invalid project bindings and unknown profiles fail without fallback', t => {
  const f = fixture(t); f.init('a');
  const file = path.join(f.home, 'devn/config.toml');
  const config = Bun.TOML.parse(fs.readFileSync(file, 'utf8'));
  for (const bad of [{ 'relative/path': 'a' }, { [f.project]: '../escape' }, { [f.project]: 7 }]) {
    fs.writeFileSync(file, Bun.TOML.stringify({ ...config, projects: bad }), { mode: 0o600 });
    assert.match(f.run(['codex']).stderr, /Invalid project bindings/);
  }
  fs.writeFileSync(file, Bun.TOML.stringify({ ...config, projects: { [f.project]: 'unknown' } }), { mode: 0o600 });
  assert.match(f.run(['claude']).stderr, /Unknown profile/);
});

test('configuration serialization escapes secrets, protects file permissions, and never logs keys', t => {
  const f = fixture(t); const secret = 'key-"-\\-{{literal}}-秘密'; f.init('a', secret);
  f.run(['profile', 'use', 'a']);
  for (const tool of ['codex', 'claude']) {
    const result = f.run([tool]); assert.equal(result.status, 0, result.stderr);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
    const captured = read(f.capture);
    assert.ok(!JSON.stringify(captured.args).includes(secret));
    const config = tool === 'codex' ? parse(captured.config) : JSON.parse(captured.config);
    assert.equal(tool === 'codex' ? config.model_providers.bifrost.experimental_bearer_token : config.env.ANTHROPIC_AUTH_TOKEN, secret);
    const file = path.join(f.home, 'devn/profiles/a', tool, tool === 'codex' ? 'config.toml' : 'settings.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  }
  assert.equal(fs.statSync(path.join(f.home, 'devn/config.toml')).mode & 0o777, 0o600);
});

test('native model definitions are copied without injecting or rewriting fields', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  const first = f.a.codex.models[0];
  first.priority = 42;
  first.visibility = 'hide';
  first.future_capability = { enabled: true, values: ['one', 'two'] };
  delete f.a.codex.models[1].priority;
  const option = f.a.claude.modelPicker.options[0];
  option.description = 'Gateway model'; option.behavesAs = 'claude-sonnet-5-5';
  f.a.claude.slots = { opus: option.model, sonnet: option.model, haiku: option.model };
  write(path.join(f.home, 'devn/profiles/a/profile.json'), f.a);
  assert.equal(f.run(['codex']).status, 0);
  assert.deepEqual(read(path.join(f.home, 'devn/profiles/a/codex/models.json')), { models: f.a.codex.models });
  assert.equal(f.run(['claude']).status, 0);
  const settings = JSON.parse(read(f.capture).config);
  assert.deepEqual(settings.modelPicker, f.a.claude.modelPicker);
  assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, option.model);
});

test('regeneration retains user settings and selected models, refreshes menus and credentials', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  for (const tool of ['codex', 'claude']) assert.equal(f.run([tool]).status, 0);
  const codexFile = path.join(f.home, 'devn/profiles/a/codex/config.toml');
  const claudeFile = path.join(f.home, 'devn/profiles/a/claude/settings.json');
  const codex = parse(fs.readFileSync(codexFile, 'utf8'));
  assert.equal(codex.web_search, 'disabled');
  codex.web_search = 'live';
  codex.model = 'a/codex-two'; codex.mcp_servers = { custom: { command: 'test-mcp' } };
  fs.writeFileSync(codexFile, stringify(codex));
  const claude = read(claudeFile); claude.model = 'a/claude-two'; claude.theme = 'dark';
  claude.permissions = { allow: ['Read'] }; claude.env.MY_SETTING = 'preserve';
  write(claudeFile, claude);
  f.init('a', 'rotated-key');
  for (const tool of ['codex', 'claude']) assert.equal(f.run([tool]).status, 0);
  assert.equal(parse(fs.readFileSync(codexFile, 'utf8')).model, 'a/codex-two');
  assert.equal(parse(fs.readFileSync(codexFile, 'utf8')).web_search, 'live');
  assert.equal(parse(fs.readFileSync(codexFile, 'utf8')).mcp_servers.custom.command, 'test-mcp');
  assert.equal(read(claudeFile).model, 'a/claude-two');
  assert.equal(read(claudeFile).theme, 'dark');
  assert.deepEqual(read(claudeFile).permissions, { allow: ['Read'] });
  assert.equal(read(claudeFile).env.MY_SETTING, 'preserve');
  assert.equal(read(claudeFile).env.ANTHROPIC_AUTH_TOKEN, 'rotated-key');
  f.a.codex.models.pop(); f.a.claude.modelPicker.options.pop();
  f.a.baseUrl = 'https://a.example.test/new';
  write(path.join(f.home, 'devn/profiles/a/profile.json'), f.a);
  for (const tool of ['codex', 'claude']) {
    const result = f.run([tool]); assert.equal(result.status, 0); assert.match(result.stderr, /no longer listed/);
  }
  assert.equal(parse(fs.readFileSync(codexFile, 'utf8')).model, 'a/codex-one');
  assert.equal(read(claudeFile).modelPicker.options.length, 1);
  assert.equal(read(claudeFile).env.ANTHROPIC_BASE_URL, 'https://a.example.test/new/anthropic');
  assert.equal(read(path.join(f.home, 'devn/profiles/a/codex/models.json')).models.length, 1);
});

test('previously managed fields are cleaned; unrelated user fields remain', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  assert.equal(f.run(['claude']).status, 0);
  const file = path.join(f.home, 'devn/profiles/a/claude/settings.json');
  const config = read(file);
  config.env.OLD_FIELD = 'retired';
  config.env.USER_FIELD = 'preserved';
  write(file, config);
  const manifest = path.join(f.home, 'devn/profiles/a/claude/.devn-managed.json');
  const metadata = read(manifest);
  metadata.paths.push(['env', 'OLD_FIELD']);
  write(manifest, metadata);
  assert.equal(f.run(['claude']).status, 0);
  assert.equal(read(file).env.OLD_FIELD, undefined);
  assert.equal(read(file).env.USER_FIELD, 'preserved');
});

test('invalid user configurations do not overwrite files or expose keys', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']); f.run(['codex']);
  const file = path.join(f.home, 'devn/profiles/a/codex/config.toml');
  const broken = 'experimental_bearer_token = "VERY-SECRET"\nbroken = [';
  fs.writeFileSync(file, broken);
  const result = f.run(['codex']); assert.notEqual(result.status, 0);
  assert.ok(!result.stderr.includes('VERY-SECRET')); assert.equal(fs.readFileSync(file, 'utf8'), broken);
  const claudeFile = path.join(f.home, 'devn/profiles/a/claude/settings.json');
  fs.writeFileSync(claudeFile, '{"secret":"VERY-SECRET",');
  const claudeResult = f.run(['claude']);
  assert.notEqual(claudeResult.status, 0);
  assert.ok(!claudeResult.stderr.includes('VERY-SECRET'));
  assert.equal(fs.readFileSync(claudeFile, 'utf8'), '{"secret":"VERY-SECRET",');
});

test('profile validation rejects unsafe IDs, mismatched defaults, slots, and duplicate models', t => {
  const f = fixture(t); const file = path.join(f.home, 'devn/profiles/a/profile.json');
  for (const modify of [
    p => { p.id = '../escape'; }, p => { p.codex.model = 'missing'; },
    p => { p.claude.slots = { haiku: 'missing' }; }, p => { p.codex.models.push(p.codex.models[0]); },
    p => { p.claude.modelPicker.options.push(p.claude.modelPicker.options[0]); },
    p => { p.claude.modelPicker.replaceBuiltInOptions = false; },
    p => { p.claude.modelPicker.options = []; },
    p => { p.claude.modelPicker.options[0].hooks = {}; },
    p => { p.claude.env = { ANTHROPIC_AUTH_TOKEN: 'remote-key' }; },
    p => { p.codex.defaultModel = p.codex.model; },
    p => { p.claude.models = []; },
    p => { delete p.codex.models[0].slug; },
    p => { p.codex.models[0].context_window = 0; },
    p => { p.codex.models[0].default_reasoning_level = 'missing'; },
    p => { p.baseUrl = 'https://secret:secret@example.test'; }, p => { p.apiKey = 'not-allowed'; },
  ]) {
    const candidate = structuredClone(f.a); modify(candidate); write(file, candidate);
    assert.throws(() => validateProfile(candidate));
  }
});

test('arguments, exit codes and stale environment are handled without shell evaluation', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  const prompt = 'literal $(touch SHOULD_NOT_EXIST) `nope` "quotes"';
  const result = f.run(['codex', 'exec', '--model', 'a/codex-two', prompt], {
    env: { ...f.env, OPENAI_API_KEY: 'old', ANTHROPIC_AUTH_TOKEN: 'old', CLAUDE_CODE_USE_BEDROCK: '1', TEST_EXIT: '7' },
  });
  assert.equal(result.status, 7); assert.equal(result.stdout, 'TOOL OUTPUT\n');
  const captured = read(f.capture); assert.ok(captured.args.includes(prompt));
  assert.equal(captured.oldOpenai, undefined); assert.equal(captured.oldAnthropic, undefined); assert.equal(captured.oldBedrock, undefined);
  assert.equal(fs.existsSync(path.join(f.project, 'SHOULD_NOT_EXIST')), false);
  for (const args of [['codex', '--profile', 'x'], ['codex', '-C/tmp'], ['codex', '-c', 'model_provider="other"'], ['claude', '--settings=/tmp/other'], ['codex', '--model', 'missing'],
    ['codex', '-c', 'model=x'], ['codex', '-c', 'model_providers.bifrost.base_url=x'], ['codex', '-c', 'model_catalog_json=x']]) {
    assert.notEqual(f.run(args).status, 0);
  }
});

test('unrelated model_* config overrides are allowed', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  assert.equal(f.run(['codex', '-c', 'model_reasoning_effort=high']).status, 0);
});

test('missing tool produces an actionable error after rendering config', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  fs.unlinkSync(path.join(f.bin, 'claude'));
  const result = f.run(['claude'], { env: { ...f.env, PATH: f.bin } });
  assert.match(result.stderr, /claude is not installed/);
});

test('parallel clients use separate configuration directories and secrets', async t => {
  const f = fixture(t); f.init('a', 'key-A'); f.init('b', 'key-B');
  const other = path.join(f.dir, 'other'); fs.mkdirSync(other);
  f.run(['profile', 'use', 'a']); f.run(['profile', 'use', 'b'], { cwd: other });
  const capA = path.join(f.dir, 'a.json'), capB = path.join(f.dir, 'b.json');
  const a = f.start(['codex'], { env: { ...f.env, TEST_CAPTURE: capA } });
  const b = f.start(['codex'], { cwd: other, env: { ...f.env, TEST_CAPTURE: capB } });
  const results = await Promise.all([once(a, 'exit'), once(b, 'exit')]);
  assert.deepEqual(results.map(r => r[0]), [0, 0]);
  assert.equal(parse(read(capA).config).model_providers.bifrost.experimental_bearer_token, 'key-A');
  assert.equal(parse(read(capB).config).model_providers.bifrost.experimental_bearer_token, 'key-B');
  assert.notEqual(read(capA).codex, read(capB).codex);
});

test('SIGINT reaches a running tool and returns 130', async t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  const child = f.start(['claude'], { env: { ...f.env, TEST_WAIT: '1' } });
  t.after(() => child.kill('SIGKILL'));
  const exited = once(child, 'exit');
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Ready timeout; stdout=${JSON.stringify(output)}`)); }, 4000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('READY')) { clearTimeout(timer); resolve(); } });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Exited before ready')));
  });
  child.kill('SIGINT');
  const timer = setTimeout(() => child.kill('SIGTERM'), 4000);
  assert.equal((await exited)[0], 130);
  clearTimeout(timer);
});

test('URL-only profiles leave native default models and menus untouched', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  f.a.codex = {}; f.a.claude = {};
  write(path.join(f.home, 'devn/profiles/a/profile.json'), f.a);
  for (const tool of ['codex', 'claude']) {
    const result = f.run([tool]); assert.equal(result.status, 0, result.stderr);
    const capture = read(f.capture);
    assert.ok(!capture.args.includes('--model'));
    const config = tool === 'codex' ? parse(capture.config) : JSON.parse(capture.config);
    assert.equal(config.model, undefined);
    assert.equal(config.model_catalog_json, undefined);
    assert.equal(config.modelPicker, undefined);
    if (tool === 'claude') assert.equal(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL, undefined);
  }
  // Native --model is unrestricted when the administrator publishes no list.
  assert.equal(f.run(['codex', '--model', 'a-new-native-model']).status, 0);
  const codexFile = path.join(f.home, 'devn/profiles/a/codex/config.toml');
  const config = parse(fs.readFileSync(codexFile, 'utf8')); config.model = 'native-saved-choice';
  fs.writeFileSync(codexFile, stringify(config));
  f.run(['codex']);
  assert.equal(parse(read(f.capture).config).model, 'native-saved-choice');
});

test('removing central models restores native menus while retaining saved choice', t => {
  const f = fixture(t); f.init('a'); f.run(['profile', 'use', 'a']);
  f.run(['codex']); f.run(['claude']);
  f.a.codex = {}; f.a.claude = {}; write(path.join(f.home, 'devn/profiles/a/profile.json'), f.a);
  assert.equal(f.run(['codex']).status, 0);
  const codex = parse(read(f.capture).config);
  assert.equal(codex.model, 'a/codex-one'); assert.equal(codex.model_catalog_json, undefined);
  assert.equal(f.run(['claude']).status, 0);
  const claude = JSON.parse(read(f.capture).config);
  assert.equal(claude.model, 'a/claude-one'); assert.equal(claude.modelPicker, undefined);
  assert.equal(claude.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined);
});

test('repository definitions and legacy credentials do not register profiles', t => {
  const f = fixture(t);
  write(path.join(f.repo, 'profiles/example.json'), f.a);
  write(path.join(f.home, 'profile/a/credentials.json'), { apiKey: 'legacy-key' });
  const result = f.run(['profile', 'list']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No profiles registered/);
  assert.match(f.run(['profile', 'use', 'a']).stderr, /Unknown profile/);
  assert.equal(read(path.join(f.home, 'profile/a/credentials.json')).apiKey, 'legacy-key');
});

test('version works without local config and profile show redacts the key and URL details', t => {
  const f = fixture(t);
  const version = require('../package.json').version;
  assert.equal(f.run(['--version']).stdout.trim(), version);
  f.init('a', 'private-test-key');
  const file = path.join(f.home, 'devn/config.toml');
  const config = parse(fs.readFileSync(file, 'utf8'));
  config.profiles.a.url = 'https://config.example.test/private-path?token=signed-token';
  fs.writeFileSync(file, stringify(config));
  const result = f.run(['profile', 'show', 'a']);
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout + result.stderr;
  for (const secret of ['private-test-key', 'private-path', 'signed-token']) assert.ok(!output.includes(secret));
  assert.equal(JSON.parse(result.stdout).key, '[redacted]');
});
