import { testPlatform } from './platform';
import * as tempFS from 'node:fs';
import * as tempOS from 'node:os';
import * as tempPath from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { addProfile as registerProfile, removeProfile, loadConfig, refreshProfile } from '../src/store';
import { configHome, profileDir } from '../src/files';

let temp: string;
let oldConfigHome: string | undefined;
let server: ReturnType<typeof Bun.serve>;
let status: number;
let payload: any;
let authorization: string | null;
let delay: number;
let respond: ((req: Request) => Response | Promise<Response>) | undefined;
const definition = { version: 1, id: 'remote-name', name: 'Remote label', baseUrl: 'https://gateway.example.test', codex: {}, claude: {} };
const addProfile = (id, url, key, expected?) => registerProfile(id, url, key, expected, async () => true);
const source = () => `http://127.0.0.1:${server.port}/profile.json`;

beforeEach(async () => {
  temp = tempFS.realpathSync.native(tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-test-')));
  oldConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = temp;
  respond = undefined;
  status = 200; payload = structuredClone(definition); delay = 0; authorization = null;
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    authorization = req.headers.get('authorization');
    if (respond) return respond(req);
    if (delay) await Bun.sleep(delay);
    return typeof payload === 'string' ? new Response(payload, { status }) : Response.json(payload, { status });
  } });
});
afterEach(async () => {
  await server.stop(true);
  if (oldConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = oldConfigHome;
  tempFS.rmSync(temp, { recursive: true, force: true });
});

test('registration is local, uses its alias, and refreshes remote routing', async () => {
  expect((await loadConfig()).profiles).toEqual([]);
  await addProfile('local', source(), 'secret');
  expect(authorization).toBeNull();
  expect((await loadConfig()).profiles[0].id).toBe('local');
  payload.baseUrl = 'https://gateway.example.test/updated';
  const result = await refreshProfile('local');
  expect(result.profile.id).toBe('local');
  expect(result.profile.baseUrl).toBe(payload.baseUrl);
  expect(result.key).toBe('secret');
  expect((await Bun.file(`${profileDir('local')}/profile.json`).json()).baseUrl).toBe(payload.baseUrl);
});

test('cancelled or invalid deferred key input does not save registration or cache', async () => {
  payload.authUrl = 'https://auth.example.test/keys';
  for (const getKey of [
    async profile => { expect(profile.authUrl).toBe(payload.authUrl); throw new Error('Cancelled.'); },
    async () => '',
  ]) {
    let approved = false;
    await expect(registerProfile('a', source(), getKey, undefined, async () => { approved = true; return true; })).rejects.toThrow();
    expect(approved).toBe(true);
    expect((await loadConfig()).profiles).toEqual([]);
    expect(await Bun.file(`${profileDir('a')}/profile.json`).exists()).toBe(false);
  }
});

test('server and network failures use cache; missing or invalid cache stops launch', async () => {
  await addProfile('a', source(), 'secret');
  status = 503;
  expect((await refreshProfile('a')).profile.baseUrl).toBe(definition.baseUrl);
  await server.stop(true);
  expect((await refreshProfile('a')).key).toBe('secret');
  await Bun.write(`${profileDir('a')}/profile.json`, 'broken');
  await expect(refreshProfile('a')).rejects.toThrow('no valid cache');
  await Bun.file(`${profileDir('a')}/profile.json`).delete();
  await expect(refreshProfile('a')).rejects.toThrow('no valid cache');
});

test('4xx, invalid JSON, and invalid definitions fail without changing cache or registration', async () => {
  await addProfile('a', source(), 'secret');
  const file = `${profileDir('a')}/profile.json`;
  const cached = await Bun.file(file).text();
  const config = await Bun.file(`${configHome()}/config.toml`).text();
  for (const [code, body] of [[403, {}], [200, '{secret'], [200, { ...definition, apiKey: 'bad' }]]) {
    status = code as number; payload = body;
    await expect(refreshProfile('a')).rejects.toThrow();
    await expect(addProfile('b', source(), 'secret')).rejects.toThrow();
    expect(await Bun.file(file).text()).toBe(cached);
    expect(await Bun.file(`${configHome()}/config.toml`).text()).toBe(config);
  }
});

test('concurrent additions retain both registrations and stale updates are rejected', async () => {
  await Promise.all([addProfile('a', source(), 'key-a'), addProfile('b', source(), 'key-b')]);
  const config = await loadConfig();
  expect(config.profiles.map(p => p.id).sort()).toEqual(['a', 'b']);
  await expect(addProfile('a', source(), 'oops')).rejects.toThrow('changed');
  const entry = config.profiles.find(p => p.id === 'a')!;
  await Bun.write(`${profileDir('a')}/codex/history.jsonl`, 'saved session');
  await addProfile('a', source(), 'new-key', entry);
  expect((await refreshProfile('a')).key).toBe('new-key');
  expect(await Bun.file(`${profileDir('a')}/codex/history.jsonl`).text()).toBe('saved session');
  await expect(addProfile('a', source(), 'stale-key', entry)).rejects.toThrow('changed');
});

test('ten-second request timeout falls back to cache', async () => {
  await addProfile('a', source(), 'secret');
  delay = 11000;
  expect((await refreshProfile('a')).key).toBe('secret');
}, testPlatform.timeout);

test('gateway origin changes require explicit approval and never replace a trusted cache', async () => {
  await addProfile('a', source(), 'secret');
  const file = `${profileDir('a')}/profile.json`;
  const before = await Bun.file(file).text();
  payload.baseUrl = 'https://different.example.test';
  await expect(refreshProfile('a')).rejects.toThrow('unapproved or changed');
  expect(await Bun.file(file).text()).toBe(before);
  const entry = (await loadConfig()).profiles[0];
  await expect(registerProfile('a', source(), 'secret', entry)).rejects.toThrow('approval cancelled');
  expect(await Bun.file(file).text()).toBe(before);
  await addProfile('a', source(), 'secret', entry);
  expect((await refreshProfile('a')).profile.baseUrl).toBe(payload.baseUrl);
});

test('registrations without trusted origins cannot launch even with a valid cache', async () => {
  await addProfile('a', source(), 'secret');
  const config = Bun.TOML.parse(await Bun.file(`${configHome()}/config.toml`).text());
  delete config.profiles.a.origins;
  await Bun.write(`${configHome()}/config.toml`, Bun.TOML.stringify(config));
  status = 503;
  await expect(refreshProfile('a')).rejects.toThrow('unapproved or changed');
});

test('adding OpenCode requires approval, preserves old profiles, and pins its own origin', async () => {
  await addProfile('a', source(), 'secret');
  expect((await refreshProfile('a')).profile.opencode).toBeUndefined();
  const cache = `${profileDir('a')}/profile.json`;
  const before = await Bun.file(cache).text();
  payload.opencode = { model: 'coding', models: { coding: { name: 'Coding' } }, baseUrl: 'https://opencode.example.test/v1' };
  await expect(refreshProfile('a')).rejects.toThrow('unapproved or changed');
  expect(await Bun.file(cache).text()).toBe(before);
  const entry = (await loadConfig()).profiles[0];
  await addProfile('a', source(), 'secret', entry);
  expect((await loadConfig()).profiles[0].origins?.opencode).toBe('https://opencode.example.test');
  payload.opencode.baseUrl = 'https://opencode.example.test/updated/v1';
  expect((await refreshProfile('a')).profile.opencode?.baseUrl).toBe(payload.opencode.baseUrl);
  payload.opencode.baseUrl = 'https://different.example.test/v1';
  await expect(refreshProfile('a')).rejects.toThrow('unapproved or changed');
});

test('HTTP outside loopback and unsafe redirects are rejected', async () => {
  await expect(addProfile('a', 'http://example.test/profile.json', 'secret')).rejects.toThrow('HTTPS');
  payload.baseUrl = 'http://example.test';
  await expect(addProfile('a', source(), 'secret')).rejects.toThrow('invalid profile');
  respond = () => new Response(null, { status: 302, headers: { location: 'http://example.test/profile.json' } });
  await expect(addProfile('a', source(), 'secret')).rejects.toThrow('unsafe URL');
  respond = () => new Response(null, { status: 302, headers: { location: source() } });
  await expect(addProfile('a', source(), 'secret')).rejects.toThrow('excessive');
});

test('oversized responses are rejected with and without Content-Length', async () => {
  await addProfile('a', source(), 'secret');
  const before = await Bun.file(`${profileDir('a')}/profile.json`).text();
  respond = () => new Response('x'.repeat(1048577), { headers: { 'content-length': '1048577' } });
  await expect(refreshProfile('a')).rejects.toThrow('1 MiB');
  respond = () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  }));
  await expect(refreshProfile('a')).rejects.toThrow('1 MiB');
  expect(await Bun.file(`${profileDir('a')}/profile.json`).text()).toBe(before);
});

test('one slow profile does not block refreshes or config updates for another', async () => {
  await addProfile('a', source() + '?slow', 'key-a');
  await addProfile('b', source(), 'key-b');
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  respond = async req => {
    if (req.url.includes('?slow')) { started(); await gate; }
    return Response.json(definition);
  };
  const slow = refreshProfile('a');
  await ready;
  try {
    const fast = Promise.all([refreshProfile('b'), addProfile('c', source(), 'key-c')]).then(() => true);
    expect(await Promise.race([fast, Bun.sleep(testPlatform.operationTimeout).then(() => false)])).toBe(true);
  } finally { release(); await slow; }
});

test('removal scrubs generated credentials, preserves history, and purge removes remaining data', async () => {
  await addProfile('a', source(), 'secret');
  const root = profileDir('a');
  await Bun.write(`${root}/codex/config.toml`, Bun.TOML.stringify({
    model_providers: { bifrost: { experimental_bearer_token: 'secret', base_url: definition.baseUrl } },
    model: 'saved-model',
  }));
  await Bun.write(`${root}/claude/settings.json`, JSON.stringify({
    env: { ANTHROPIC_AUTH_TOKEN: 'secret', USER_SETTING: 'preserved' },
  }));
  await Bun.write(`${root}/codex/history.jsonl`, 'history');
  await Bun.write(`${root}/opencode/opencode.json`, JSON.stringify({
    providers: { bifrost: { settings: { apiKey: 'secret', baseURL: definition.baseUrl } } },
    agents: { custom: { description: 'Local agent' } },
  }));
  await Bun.write(`${root}/opencode/data/opencode/opencode.db`, 'saved sessions');
  await removeProfile('a');
  expect((await loadConfig()).profiles).toEqual([]);
  expect(await Bun.file(`${root}/codex/config.toml`).text()).not.toContain('secret');
  expect(await Bun.file(`${root}/claude/settings.json`).text()).not.toContain('secret');
  expect(await Bun.file(`${root}/opencode/opencode.json`).text()).not.toContain('secret');
  expect((await Bun.file(`${root}/opencode/opencode.json`).json()).agents.custom.description).toBe('Local agent');
  expect(await Bun.file(`${root}/opencode/data/opencode/opencode.db`).text()).toBe('saved sessions');
  expect(await Bun.file(`${root}/codex/history.jsonl`).text()).toBe('history');
  expect((await Bun.file(`${root}/claude/settings.json`).json()).env.USER_SETTING).toBe('preserved');
  await removeProfile('a', true);
  expect(await Bun.file(`${root}/codex/history.jsonl`).exists()).toBe(false);
  expect(await Bun.file(`${root}/opencode/data/opencode/opencode.db`).exists()).toBe(false);
});

test('malformed retained client config prevents all credential writes and preserves registration', async () => {
  // The current remote profile has no OpenCode section, but its old credentials
  // must still be checked before changing either of the other configurations.
  await addProfile('a', source(), 'dummy-removal-key');
  const root = profileDir('a');
  const codex = Bun.TOML.stringify({ model_providers: { bifrost: { experimental_bearer_token: 'dummy-removal-key' } } });
  const claude = JSON.stringify({ env: { ANTHROPIC_API_KEY: 'dummy-removal-key' } });
  await Bun.write(`${root}/codex/config.toml`, codex);
  await Bun.write(`${root}/claude/settings.json`, claude);
  await Bun.write(`${root}/opencode/opencode.json`, '{"apiKey":"dummy-removal-key"');
  await expect(removeProfile('a')).rejects.toThrow('Cannot safely remove credentials from opencode configuration. Repair it or use --purge.');
  expect(await Bun.file(`${root}/codex/config.toml`).text()).toBe(codex);
  expect(await Bun.file(`${root}/claude/settings.json`).text()).toBe(claude);
  expect((await loadConfig()).profiles[0].id).toBe('a');
  await removeProfile('a', true);
  expect((await loadConfig()).profiles).toEqual([]);
  expect(tempFS.existsSync(root)).toBe(false);
});

test('trusted origins reject missing required clients and unknown client names', async () => {
  await addProfile('a', source(), 'dummy-origin-key');
  const file = `${configHome()}/config.toml`;
  const original = Bun.TOML.parse(await Bun.file(file).text()) as any;
  for (const origins of [
    { codex: definition.baseUrl },
    { claude: definition.baseUrl },
    { ...original.profiles.a.origins, unknown: definition.baseUrl },
    { ...original.profiles.a.origins, constructor: definition.baseUrl },
  ]) {
    const config = structuredClone(original);
    config.profiles.a.origins = origins;
    await Bun.write(file, Bun.TOML.stringify(config));
    await expect(loadConfig()).rejects.toThrow('Invalid trusted gateway origins.');
  }
});


test('manual re-add repairs malformed generated config only after approval and retains history', async () => {
  await addProfile('a', source(), 'dummy-old-key');
  const previous = (await loadConfig()).profiles[0], root = profileDir('a');
  const file = `${root}/opencode/opencode.json`;
  await Bun.write(file, '{"apiKey":"dummy-old-key"');
  await Bun.write(`${root}/opencode/history.jsonl`, 'dummy-history');
  await expect(registerProfile('a', source(), 'dummy-new-key', previous, async () => false)).rejects.toThrow('cancelled');
  expect(await Bun.file(file).text()).toContain('dummy-old-key');
  await addProfile('a', source(), 'dummy-new-key', previous);
  expect((await loadConfig()).profiles[0].key).toBe('dummy-new-key');
  expect(await Bun.file(file).exists()).toBe(false);
  expect(await Bun.file(`${root}/opencode/history.jsonl`).text()).toBe('dummy-history');
});
