import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { platform } from '../src/platform';
import { validateProfile } from '../src/profile';
import { addProfile, loadConfig, refreshProfile, removeProfile, bindProject, profileSession } from '../src/store';
import { prepareConfig } from '../src/store';
import { configHome, profileDir } from '../src/files';
import { loginCredentials, syncCredentials } from '../src/oauth/lifecycle';
import { readSession, saveSession, deleteSession } from '../src/oauth/session';
import { discover, request, tokens } from '../src/oauth/protocol';
import type { AuthMode } from '../src/oauth/authorize';
import type { OAuthBinding } from '../src/types';
import { testPlatform } from './platform';

type Grant = { id: number; access: string; refresh: string; resource: string; active: boolean; rotations: number; failure?: { status: number; error: string }; refreshError?: string };
let temp: string, oldHome: string | undefined, server: ReturnType<typeof Bun.serve>;
let auth: OAuthBinding, profile: any, metadata: any;
let key: string | undefined, pending: string[], deviceExpiry: number, transientRefresh: number, revocationFailure: boolean;
let calls: { path: string; url: string; method: string; body: URLSearchParams; bearer: string | null; time: number }[];
let grants: Grant[], nextFailure: Grant['failure'];
let challenge: string, redirect: string;
let keyResponse: any;
let nonRotating: boolean, endpointFailure: { path: string; status: number; error?: string } | undefined;
const originalBrowser = platform.openBrowser, originalDesktop = platform.hasDesktop;
const source = () => `${server.url.origin}/profile.json`;
const entry = async (id = 'a') => (await loadConfig()).profiles.find(p => p.id === id)!;
const ref = async (id = 'a') => profileSession(await entry(id))!;
async function sessionGrant(id = 'a') {
  const tokens = readSession(await ref(id))!;
  return grants.find(g => g.access === tokens.access)!;
}
async function register(id = 'a', mode: AuthMode = 'browser') {
  await addProfile(id, source(), (_p, session) => loginCredentials(session!, mode), await entry(id), async () => true);
}
function tokenResponse(g: Grant) {
  return Response.json({ access_token: g.access, refresh_token: g.refresh, expires_in: 600, token_type: 'Bearer' });
}
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'devn-oauth-'));
  oldHome = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = temp;
  calls = []; grants = []; key = undefined; pending = []; nextFailure = undefined;
  keyResponse = undefined; nonRotating = false; endpointFailure = undefined;
  deviceExpiry = 60; transientRefresh = 0; revocationFailure = false; challenge = ''; redirect = '';
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const pathname = new URL(req.url).pathname;
    const body = new URLSearchParams(req.method === 'POST' ? await req.text() : '');
    calls.push({ path: pathname, url: req.url, method: req.method, body, bearer: req.headers.get('authorization'), time: Date.now() });
    if (endpointFailure?.path === pathname) return endpointFailure.error
      ? Response.json({ error: endpointFailure.error }, { status: endpointFailure.status })
      : new Response('<html>misrouted</html>', { status: endpointFailure.status });
    if (pathname === '/profile.json') return Response.json(profile);
    if (pathname.startsWith('/.well-known/')) return Response.json(metadata);
    if (pathname === '/api/auth/device/code') return Response.json({ device_code: 'dummy-device', user_code: 'DUMMY-CODE', verification_uri: `${server.url.origin}/device`, expires_in: deviceExpiry, interval: 0.01 });
    if (pathname === '/api/auth/oauth2/token') {
      expect(body.has('client_secret')).toBe(false);
      expect(body.get('client_id')).toBe('cli');
      const kind = body.get('grant_type');
      if (kind === 'refresh_token') {
        const g = grants.find(g => g.refresh === body.get('refresh_token'));
        if (!g?.active || g.refreshError) return Response.json({ error: g?.refreshError || 'invalid_grant' }, { status: 400 });
        expect(body.get('resource')).toBe(g.resource);
        if (transientRefresh-- > 0) return Response.json({ error: 'server_error' }, { status: 502 });
        if (nonRotating) {
          g.access = `dummy-access-${g.id}-renewed`;
          return Response.json({ access_token: g.access, expires_in: 600, token_type: 'Bearer' });
        }
        g.rotations++; g.access = `dummy-access-${g.id}-${g.rotations}`; g.refresh = `dummy-refresh-${g.id}-${g.rotations}`;
        return tokenResponse(g);
      }
      if (kind === 'authorization_code') {
        expect(body.get('code')).toBe('dummy-code');
        expect(body.get('redirect_uri')).toBe(redirect);
        expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge);
      } else {
        expect(kind).toBe('urn:ietf:params:oauth:grant-type:device_code');
        const error = pending.shift();
        if (error) return Response.json({ error }, { status: 400 });
      }
      const id = grants.length + 1;
      const g: Grant = { id, access: `dummy-access-${id}-0`, refresh: `dummy-refresh-${id}-0`, resource: body.get('resource')!, rotations: 0, active: true, failure: nextFailure };
      grants.push(g);
      return tokenResponse(g);
    }
    if (pathname === '/api/auth/oauth2/revoke') {
      if (revocationFailure) return Response.json({ error: 'server_error' }, { status: 502 });
      const g = grants.find(g => g.refresh === body.get('token'));
      if (g) g.active = false;
      return new Response(null, { status: 204 });
    }
    // There is intentionally no /me endpoint. Resources can have arbitrary paths and queries.
    const g = grants.find(g => `Bearer ${g.access}` === req.headers.get('authorization'));
    if (g && req.url === g.resource) {
      if (!g.active) return Response.json({ error: 'invalid_token' }, { status: 401 });
      if (g.failure) return Response.json({ error: g.failure.error }, { status: g.failure.status });
      if (req.method === 'POST') key = 'dummy-bifrost-key';
      if (!key) return Response.json({ error: 'key_missing' }, { status: 404 });
      return Response.json(keyResponse ?? { key });
    }
    return new Response(null, { status: 404 });
  } });
  const origin = server.url.origin;
  auth = { type: 'oauth2', issuer: `${origin}/api/auth`, clientId: 'cli', resource: `${origin}/arbitrary/credential?route=opaque` };
  profile = { version: 1, id: 'a', name: 'Test', baseUrl: origin, codex: {}, claude: {}, auth };
  metadata = { issuer: auth.issuer, authorization_endpoint: `${auth.issuer}/oauth2/authorize`, token_endpoint: `${auth.issuer}/oauth2/token`, revocation_endpoint: `${auth.issuer}/oauth2/revoke`, device_authorization_endpoint: `${auth.issuer}/device/code`, code_challenge_methods_supported: ['S256'] };
  platform.hasDesktop = () => true;
  platform.openBrowser = async value => {
    const url = new URL(value);
    expect(url.searchParams.get('scope')).toBe('bifrost:key:read bifrost:key:ensure offline_access');
    expect(url.searchParams.get('resource')).toBe(profile.auth.resource);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    challenge = url.searchParams.get('code_challenge')!; redirect = url.searchParams.get('redirect_uri')!;
    expect(new URL(redirect).hostname).toBe('127.0.0.1'); expect(new URL(redirect).port).not.toBe('');
    const callback = new URL(redirect);
    callback.search = new URLSearchParams({ code: 'dummy-code', state: url.searchParams.get('state')!, iss: auth.issuer }).toString();
    const badState = new URL(callback); badState.searchParams.set('state', 'wrong');
    expect((await fetch(badState)).status).toBe(400);
    const badIssuer = new URL(callback); badIssuer.searchParams.set('iss', `${auth.issuer}/wrong`);
    expect((await fetch(badIssuer)).status).toBe(400);
    expect((await fetch(callback)).status).toBe(200);
  };
});
afterEach(async () => {
  platform.openBrowser = originalBrowser; platform.hasDesktop = originalDesktop;
  await server.stop(true);
  if (oldHome === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldHome;
  fs.rmSync(temp, { recursive: true, force: true });
});

test('PKCE login uses the exact opaque key resource without identity fields or /me', async () => {
  let approved = false;
  await addProfile('a', source(), async (_p, session) => { expect(approved).toBe(true); return loginCredentials(session!, 'browser'); }, undefined, async () => { approved = true; return true; });
  expect(Object.keys(readSession(await ref())!).sort()).toEqual(['access', 'expires', 'refresh']);
  expect(await syncCredentials('a')).toBe(key);
  const keyCalls = calls.filter(c => c.url === auth.resource);
  expect(keyCalls.map(c => c.method)).toEqual(['GET', 'POST', 'GET']);
  expect(calls.some(c => c.path.endsWith('/me'))).toBe(false);
  expect(calls.some(c => c.path === '/.well-known/oauth-authorization-server/api/auth')).toBe(true);
  const text = await Bun.file(`${configHome()}/config.toml`).text();
  expect(text).not.toContain('dummy-access'); expect(text).not.toContain('dummy-refresh');
  expect(Bun.TOML.parse(text).version).toBe(3);
  const config = await prepareConfig(validateProfile(profile), 'codex', key!);
  expect(await Bun.file(config.file).text()).not.toContain('dummy-access');
  testPlatform.assertPrivate(`${configHome()}/oauth/${(await ref()).id}.json`, 0o600);
  testPlatform.assertPrivate(`${configHome()}/oauth`, 0o700);
});

test('identical auth in two profiles creates different persistent session IDs and tokens; re-add reuses only its own', async () => {
  await register(); await register('b');
  const a = await ref(), b = await ref('b');
  expect(a.id).not.toBe(b.id);
  expect(readSession(a)?.refresh).not.toBe(readSession(b)?.refresh);
  expect(readSession(a)?.access).not.toBe(readSession(b)?.access);
  expect(grants).toHaveLength(2);
  await register();
  expect((await ref()).id).toBe(a.id); expect(grants).toHaveLength(2);
  await removeProfile('a');
  expect(readSession(a)).toBeUndefined(); expect(readSession(b)).toBeDefined();
  expect(await syncCredentials('b')).toBe(key); expect(grants[1].active).toBe(true);
});

test('re-add permission 403 and non-key-missing 404 invalidate only their own registration', async () => {
  await register(); await register('b');
  const b = await entry('b'), bTokens = readSession(await ref('b'));
  const aFile = await prepareConfig(validateProfile(profile), 'codex', key!);
  const bFile = await prepareConfig(validateProfile({ ...profile, id: 'b' }), 'codex', key!);
  for (const status of [403, 404]) {
    const g = await sessionGrant(); g.failure = { status, error: 'insufficient_scope' };
    await expect(register()).rejects.toThrow();
    expect((await entry()).key).toBe('');
    expect(await Bun.file(aFile.file).text()).not.toContain('dummy-bifrost-key');
    expect(await entry('b')).toEqual(b); expect(readSession(await ref('b'))).toEqual(bTokens);
    expect(await Bun.file(bFile.file).text()).toContain('dummy-bifrost-key');
  }
  expect(calls.filter(c => c.url === auth.resource && c.method === 'POST')).toHaveLength(1);
  nextFailure = { status: 403, error: 'insufficient_scope' };
  await expect(register('c')).rejects.toThrow();
  expect(await entry('c')).toBeUndefined(); expect(await syncCredentials('b')).toBe(key);
});

test('malformed session at startup clears its token, cached key and generated credentials, preserving the other profile', async () => {
  await register(); await register('b');
  const a = await ref(), b = await entry('b');
  const file = await prepareConfig(validateProfile(profile), 'claude', key!);
  for (const corrupt of ['{broken-dummy', JSON.stringify({ version: 2, id: a.id, auth: null, revision: 'dummy' })]) {
    await Bun.write(`${configHome()}/oauth/${a.id}.json`, corrupt);
    await expect(syncCredentials('a')).rejects.toThrow('profile add');
    expect(readSession(a)).toBeUndefined(); expect((await entry()).key).toBe('');
    expect(await Bun.file(file.file).text()).not.toContain('dummy-bifrost-key');
    expect(await entry('b')).toEqual(b); expect(await syncCredentials('b')).toBe(key);
    await register(); expect((await ref()).id).toBe(a.id); expect((await entry()).key).toBe(key);
    await prepareConfig(validateProfile(profile), 'claude', key!);
  }
});

test('startup rotation, 502 fallback, missing-key invalidation and explicit add-only creation', async () => {
  await register();
  key = 'dummy-rotated-key'; expect(await syncCredentials('a')).toBe(key);
  const generated = await prepareConfig(validateProfile(profile), 'codex', key);
  const g = await sessionGrant(); g.failure = { status: 502, error: 'server_error' };
  expect(await syncCredentials('a')).toBe(key);
  g.failure = undefined; key = undefined;
  await expect(syncCredentials('a')).rejects.toThrow('key_missing');
  expect((await entry()).key).toBe(''); expect(await Bun.file(generated.file).text()).not.toContain('dummy-rotated-key');
  g.failure = { status: 502, error: 'server_error' };
  await expect(syncCredentials('a')).rejects.toThrow();
  expect(calls.filter(c => c.url === auth.resource && c.method === 'POST')).toHaveLength(1);
  g.failure = undefined; await register();
  expect(calls.filter(c => c.url === auth.resource && c.method === 'POST')).toHaveLength(2);
});

test('401 refreshes once, invalid_grant is isolated, and one re-add restores authorization', async () => {
  await register(); await register('b');
  const a = await ref(), g = await sessionGrant();
  g.failure = { status: 401, error: 'invalid_token' };
  await expect(syncCredentials('a')).rejects.toThrow(); expect(g.rotations).toBe(1);
  expect(readSession(a)).toBeUndefined(); expect((await entry('b')).key).toBe(key);
  await register(); const renewed = await sessionGrant(); renewed.refreshError = 'invalid_grant';
  saveSession(a, { ...readSession(a)!, expires: 0 });
  await register(); expect(grants).toHaveLength(4); expect((await ref()).id).toBe(a.id);
  expect(await syncCredentials('b')).toBe(key);
});

test('reauthorization clears the old session cache before browser wait, without affecting other profiles', async () => {
  await register(); await register('b');
  const a = await ref(), b = await entry('b'), before = readSession(a)!;
  const generated = await prepareConfig(validateProfile(profile), 'claude', key!);
  deleteSession(a);
  const browser = platform.openBrowser;
  platform.openBrowser = async url => {
    expect((await entry()).key).toBe('');
    expect(await Bun.file(generated.file).text()).not.toContain(key!);
    expect(await entry('b')).toEqual(b);
    await browser(url);
  };
  await register();
  expect((await ref()).id).toBe(a.id);
  expect(readSession(a)?.access).not.toBe(before.access);
  expect((await entry()).key).toBe(key);
});

test('remove, manual and rebinding retire only their own sessions; network revocation failure still cleans locally', async () => {
  await register(); await register('b');
  const oldA = await ref(), b = await ref('b');
  profile.auth = { ...auth, resource: `${server.url.origin}/different/key-location?x=1` };
  await register(); const newA = await ref();
  expect(newA.id).not.toBe(oldA.id); expect(readSession(oldA)).toBeUndefined(); expect(readSession(b)).toBeDefined();
  await addProfile('a', source(), 'dummy-manual', await entry(), async () => true);
  expect(readSession(newA)).toBeUndefined(); expect(readSession(b)).toBeDefined();
  await bindProject(temp, 'b'); await Bun.write(`${profileDir('b')}/codex/history.jsonl`, 'dummy-history');
  revocationFailure = true; await removeProfile('b');
  expect(readSession(b)).toBeUndefined(); expect((await loadConfig()).projects[temp]).toBe('b');
  expect(await Bun.file(`${profileDir('b')}/codex/history.jsonl`).text()).toBe('dummy-history');
});

test('failed registration retires its unique session without disturbing an identical registered profile', async () => {
  await register(); const a = await ref(), initial = readSession(a);
  await expect(addProfile('a', source(), (_p, session) => loginCredentials(session!, 'browser'), undefined, async () => true)).rejects.toThrow('changed');
  expect(readSession(a)).toEqual(initial); expect(grants[0].active).toBe(true); expect(grants[1].active).toBe(false);
  await expect(addProfile('b', source(), () => { throw new Error('must not authenticate'); }, undefined, async () => false)).rejects.toThrow('approval cancelled');
  expect(grants).toHaveLength(2);
});

test('removal during browser wait rejects late callback and does not resurrect the profile session', async () => {
  await register(); const a = await ref(); deleteSession(a);
  let resume!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const callback = platform.openBrowser;
  platform.openBrowser = async url => { started(); await gate; await callback(url); };
  const adding = register(); await waiting;
  await removeProfile('a'); resume();
  await expect(adding).rejects.toThrow('session changed');
  expect(readSession(a)).toBeUndefined(); expect(await entry()).toBeUndefined();
});

test('cross-process refresh serializes one profile without rotating the identical other profile', async () => {
  await register(); await register('b'); const a = await ref(), b = await ref('b');
  const untouched = readSession(b); saveSession(a, { ...readSession(a)!, expires: 0 });
  const module = path.resolve(import.meta.dir, '../src/oauth/lifecycle.ts');
  const children = Array.from({ length: 3 }, () => Bun.spawn([process.execPath, '-e', `import { syncCredentials } from ${JSON.stringify(module)}; await syncCredentials('a');`], { env: process.env, stdout: 'pipe', stderr: 'pipe' }));
  for (const child of children) expect(await child.exited).toBe(0);
  expect(grants[0].rotations).toBe(1); expect(readSession(b)).toEqual(untouched);
});

test('device uses unified token endpoint, pending, slow_down, expiry and auto headless selection', async () => {
  platform.hasDesktop = () => false; pending = ['authorization_pending', 'slow_down'];
  await register('a', 'auto');
  const polls = calls.filter(c => c.path.endsWith('/token'));
  expect(polls).toHaveLength(3); expect(polls[2].time - polls[1].time).toBeGreaterThanOrEqual(5000);
  pending = ['access_denied']; await expect(register('b', 'device')).rejects.toThrow('access_denied');
  deviceExpiry = 0.03; pending = Array(10).fill('authorization_pending');
  await expect(register('b', 'device')).rejects.toThrow('expired_token');
});

test('discovery pins issuer and endpoint origins; changed resource requires add and leaves cache intact', async () => {
  await register(); const original = await Bun.file(`${profileDir('a')}/profile.json`).text();
  profile.auth = { ...auth, resource: `${auth.resource}&changed=1` };
  await expect(refreshProfile('a')).rejects.toThrow('binding changed');
  expect(await Bun.file(`${profileDir('a')}/profile.json`).text()).toBe(original);
  metadata.issuer += '/different'; await expect(discover(auth)).rejects.toThrow('issuer_mismatch');
  metadata.issuer = auth.issuer; metadata.token_endpoint = 'https://other.example.test/token';
  await expect(discover(auth)).rejects.toThrow('endpoint_origin');
});

test('old auth and config schemas are rejected without compatibility or migration', async () => {
  expect(() => validateProfile({ ...profile, auth: { ...auth, instanceId: '00000000-0000-4000-8000-000000000001' } })).toThrow();
  await register(); const a = await ref();
  const file = `${configHome()}/config.toml`, original = await Bun.file(file).text();
  const tokenFile = `${configHome()}/oauth/${a.id}.json`, tokenText = await Bun.file(tokenFile).text();
  for (const version of [1, 2, 4]) {
    const config = Bun.TOML.parse(original); config.version = version;
    const legacy = Bun.TOML.stringify(config); await Bun.write(file, legacy);
    await expect(loadConfig()).rejects.toThrow('supported version: 3');
    expect(await Bun.file(file).text()).toBe(legacy); expect(await Bun.file(tokenFile).text()).toBe(tokenText);
  }
});

test('session IDs cannot be shared or used as paths; remote auth accepts only four fields', async () => {
  await register(); await register('b');
  for (const change of [{ clientSecret: 'dummy' }, { resource: 'https://other.example.test/key' }, { issuer: `${auth.issuer}/{env:HOME}` }]) expect(() => validateProfile({ ...profile, auth: { ...auth, ...change } })).toThrow();
  const file = `${configHome()}/config.toml`, original = await Bun.file(file).text();
  for (const id of [(await ref()).id, '../other']) {
    const config = Bun.TOML.parse(original); config.profiles.b.sessionId = id;
    await Bun.write(file, Bun.TOML.stringify(config)); await expect(loadConfig()).rejects.toThrow();
  }
});

test('secret requests refuse redirects without contacting destination', async () => {
  let leaked = false;
  const target = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { leaked = true; return Response.json({}); } });
  const redirector = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return new Response(null, { status: 307, headers: { location: target.url.href } }); } });
  try { await expect(request(redirector.url.href, { method: 'POST', body: 'refresh_token=dummy' })).rejects.toThrow('redirect_refused'); expect(leaked).toBe(false); }
  finally { await redirector.stop(true); await target.stop(true); }
});

test('interrupted response is unavailable but malformed JSON is a hard failure', async () => {
  const sockets = new Set<net.Socket>();
  const partial = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => { socket.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{"partial":'); setTimeout(() => socket.destroy(), 20); });
  });
  await new Promise<void>(resolve => partial.listen(0, '127.0.0.1', resolve));
  try {
    const address = partial.address() as net.AddressInfo;
    try { await request(`http://127.0.0.1:${address.port}`); throw new Error('Expected network failure'); }
    catch (error: any) { expect(error.code).toBe('network'); expect(error.unavailable).toBe(true); }
  } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => partial.close(() => resolve())); }
  const invalid = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return new Response('{invalid'); } });
  try { await expect(request(invalid.url.href)).rejects.toThrow('invalid_response'); } finally { await invalid.stop(true); }
});

test('refresh failure retries the identical grant within the response recovery window', async () => {
  await register(); const a = await ref(); saveSession(a, { ...readSession(a)!, expires: 0 }); transientRefresh = 1;
  expect(await syncCredentials('a')).toBe(key);
  const refreshes = calls.filter(c => c.body.get('grant_type') === 'refresh_token');
  expect(refreshes).toHaveLength(2); expect(refreshes[0].body.toString()).toBe(refreshes[1].body.toString());
  expect(refreshes[1].time - refreshes[0].time).toBeLessThan(30000);
});


test('refresh without rotation retains the previous refresh token across successive refreshes', async () => {
  await register(); const a = await ref(), before = readSession(a)!;
  nonRotating = true;
  for (let i = 0; i < 2; i++) {
    saveSession(a, { ...readSession(a)!, expires: 0 });
    expect(await syncCredentials('a')).toBe(key);
    expect(readSession(a)?.refresh).toBe(before.refresh);
    expect((await ref()).id).toBe(a.id);
    expect(readSession(a)?.expires).toBeGreaterThan(Date.now());
  }
  const response = { access_token: 'dummy-access', token_type: 'Bearer', expires_in: 600 };
  expect(() => tokens(response)).toThrow('invalid_token_response');
  for (const invalid of ['', null, 123, 'bad token']) {
    expect(() => tokens({ ...response, refresh_token: invalid }, before.refresh)).toThrow('invalid_token_response');
  }
});

test('discovery and refresh HTTP failures stop without erasing cached credentials or starting a new login', async () => {
  await register(); const a = await ref();
  const generated = await prepareConfig(validateProfile(profile), 'claude', key!);
  saveSession(a, { ...readSession(a)!, expires: 0 });
  const saved = readSession(a), local = await entry(), config = await Bun.file(generated.file).text();
  for (const endpoint of ['/.well-known/oauth-authorization-server/api/auth', '/api/auth/oauth2/token']) {
    for (const status of [401, 403, 404]) {
      endpointFailure = { path: endpoint, status };
      await expect(syncCredentials('a')).rejects.toThrow();
      await expect(register()).rejects.toThrow();
      expect(readSession(a)).toEqual(saved); expect(await entry()).toEqual(local);
      expect(await Bun.file(generated.file).text()).toBe(config);
      expect(grants).toHaveLength(1);
    }
  }
  endpointFailure = { path: '/api/auth/oauth2/token', status: 403, error: 'account_disabled' };
  await expect(syncCredentials('a')).rejects.toThrow('account_disabled');
  expect(readSession(a)).toBeUndefined(); expect((await entry()).key).toBe('');
});

test('fresh authorization failures cannot retain a previous session key', async () => {
  await register(); const a = await ref();
  const generated = await prepareConfig(validateProfile(profile), 'claude', key!);
  // Missing tokens require fresh authorization, so the old cache must be cleared first.
  deleteSession(a);
  const local = await entry(), config = await Bun.file(generated.file).text();
  for (const mode of ['browser', 'device'] as const) {
    for (const status of [403, 404, 400, 502]) {
      endpointFailure = { path: '/api/auth/oauth2/token', status, error: status === 400 ? 'invalid_grant' : undefined };
      await expect(register('a', mode)).rejects.toThrow();
      expect(await entry()).toEqual({ ...local, key: '' });
      expect(await Bun.file(generated.file).text()).not.toContain(local.key);
    }
  }
});

test('re-add and key rotation remove malformed generated credentials while preserving history and other profiles', async () => {
  await register(); await register('b');
  const root = profileDir('a'), b = await entry('b');
  const generated = await prepareConfig(validateProfile(profile), 'claude', key!);
  await Bun.write(`${root}/claude/history.jsonl`, 'dummy-history');
  await Bun.write(generated.file, '{"dummy-old-key":');
  await register();
  expect(await Bun.file(generated.file).exists()).toBe(false);
  await prepareConfig(validateProfile(profile), 'claude', key!);
  await Bun.write(generated.file, '{"dummy-old-key":');
  key = 'dummy-rotated-key';
  expect(await syncCredentials('a')).toBe(key);
  expect((await entry()).key).toBe(key);
  expect(await Bun.file(generated.file).exists()).toBe(false);
  await prepareConfig(validateProfile(profile), 'claude', key);
  expect(await Bun.file(generated.file).text()).toContain(key);
  expect(await Bun.file(`${root}/claude/history.jsonl`).text()).toBe('dummy-history');
  expect(await entry('b')).toEqual(b);
});

test('failed credential cleanup does not commit a rotated key', async () => {
  await register(); const local = await entry();
  const generated = await prepareConfig(validateProfile(profile), 'claude', key!);
  const { clients } = await import('../src/clients');
  const client = clients.find(c => c.id === 'claude')!, original = client.config.scrub;
  const rm = fs.rmSync;
  // Simulate an unrepairable disk error after parsing/cleanup fails.
  client.config.scrub = () => { throw new Error('dummy failure'); };
  fs.rmSync = ((file, options) => {
    if (String(file) === generated.file) throw new Error('dummy disk failure');
    return rm(file, options);
  }) as typeof fs.rmSync;
  try {
    key = 'dummy-rotated-key';
    await expect(syncCredentials('a')).rejects.toThrow('dummy disk failure');
    expect(await entry()).toEqual(local);
    expect(await Bun.file(generated.file).text()).toContain(local.key);
  } finally { client.config.scrub = original; fs.rmSync = rm; }
  expect(await syncCredentials('a')).toBe(key);
  expect(await Bun.file(generated.file).text()).not.toContain(local.key);
});


test('key-only responses ignore optional fields and reject old value responses without fallback', async () => {
  keyResponse = { key: 'dummy-key-only', future: { opaque: true } };
  await register(); expect((await entry()).key).toBe('dummy-key-only');
  const a = await ref();
  keyResponse = { value: 'dummy-legacy-key' };
  await expect(syncCredentials('a')).rejects.toThrow('invalid_key_response');
  deleteSession(a);
  await expect(register()).rejects.toThrow('invalid_key_response');
  expect((await entry()).key).toBe('');
  expect(readSession(a)).toBeUndefined();
  expect(calls.some(c => c.path.endsWith('/me'))).toBe(false);
});

test('failed rebinding clears only the old profile cache and prevents network fallback', async () => {
  await register(); await register('b'); const a = await ref(), b = await entry('b');
  const generated = await prepareConfig(validateProfile(profile), 'claude', key!);
  profile.auth = { ...auth, resource: `${server.url.origin}/api/instances/dummy-new` };
  endpointFailure = { path: '/api/auth/oauth2/token', status: 502 };
  await expect(register()).rejects.toThrow();
  expect((await entry()).key).toBe(''); expect(readSession(a)).toBeUndefined();
  expect(await Bun.file(generated.file).text()).not.toContain(key!);
  expect(await entry('b')).toEqual(b);
  await expect(syncCredentials('a')).rejects.toThrow('Not logged in');
});

test('a newer session revision rejects credentials returned by an earlier add attempt', async () => {
  await register(); const existing = await entry();
  await expect(addProfile('a', source(), async (_profile, session) => {
    const credentials = await loginCredentials(session!, 'browser');
    saveSession(session!, { ...readSession(session!)!, access: 'dummy-newer-access' });
    return credentials;
  }, existing, async () => true)).rejects.toThrow('OAuth session changed');
  expect(await entry()).toEqual(existing);
});


test('cancelled reauthorization leaves no old session cache available for fallback', async () => {
  await register(); const a = await ref();
  const generated = await prepareConfig(validateProfile(profile), 'claude', key!);
  deleteSession(a);
  platform.openBrowser = async () => { process.emit('SIGINT'); };
  await expect(register()).rejects.toThrow();
  expect((await entry()).key).toBe(''); expect(readSession(a)).toBeUndefined();
  expect(await Bun.file(generated.file).text()).not.toContain(key!);
  endpointFailure = { path: '/api/auth/oauth2/token', status: 502 };
  await expect(syncCredentials('a')).rejects.toThrow('Not logged in');
});

test('subject-bearing local data is rejected without compatibility or migration', async () => {
  await register(); const a = await ref();
  const file = `${configHome()}/config.toml`, config = Bun.TOML.parse(await Bun.file(file).text()) as any;
  config.profiles.a.subject = 'dummy-old-subject';
  const old = Bun.TOML.stringify(config);
  await Bun.write(file, old);
  await expect(loadConfig()).rejects.toThrow('Invalid profile registration');
  expect(await Bun.file(file).text()).toBe(old);
  delete config.profiles.a.subject;
  await Bun.write(file, Bun.TOML.stringify(config));
  const sessionFile = `${configHome()}/oauth/${a.id}.json`, session = await Bun.file(sessionFile).json();
  session.tokens.subject = 'dummy-old-subject';
  await Bun.write(sessionFile, JSON.stringify(session));
  expect(() => readSession(a)).toThrow('Invalid OAuth session');
});
