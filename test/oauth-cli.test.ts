import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fixture } from './helpers';
import { testPlatform } from './platform';

async function run(f, args: string[], answers: [string, string][] = [], interrupt = false) {
  let output = '', stage = 0, signalled = false;
  const child = Bun.spawn([process.execPath, path.join(f.repo, 'bin/devn'), ...args], {
    env: { ...f.env, SSH_CONNECTION: 'dummy-ssh-session' }, cwd: f.project,
    terminal: { cols: 180, rows: 40, data(terminal, bytes) {
      output += Bun.stripANSI(new TextDecoder().decode(bytes));
      if (stage < answers.length && output.includes(answers[stage][0])) terminal.write(answers[stage++][1] + testPlatform.enter);
      if (interrupt && !signalled && output.includes('Enter code:')) { signalled = true; child.kill('SIGINT'); }
    } },
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
  try { return { code: await child.exited, output, stage }; }
  finally { clearTimeout(timeout); child.terminal.close(); }
}

test('CLI URL add and SSH auto device login, re-add authentication and automatic session retirement, manual opt-out and argument validation', async t => {
  const f = fixture(t);
  let ensures = 0, authorizations = 0, revocations = 0, present = false, pending = false, rejectRefresh = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const origin = server.url.origin, issuer = `${origin}/api/auth`, resource = `${origin}/opaque-credential?audience=cli`;
    const pathname = new URL(req.url).pathname;
    if (pathname === '/team.json') return Response.json({ version: 1, baseUrl: origin, codex: {}, claude: {}, auth: { type: 'oauth2', issuer, resource, clientId: 'cli' } });
    if (pathname.startsWith('/.well-known/')) return Response.json({ issuer, authorization_endpoint: `${issuer}/oauth2/authorize`, device_authorization_endpoint: `${issuer}/device/code`, token_endpoint: `${issuer}/oauth2/token`, revocation_endpoint: `${issuer}/oauth2/revoke`, code_challenge_methods_supported: ['S256'] });
    if (pathname.endsWith('/device/code')) { authorizations++; return Response.json({ device_code: 'dummy-device', user_code: 'DUMMY-CODE', verification_uri: `${origin}/device`, expires_in: 60, interval: 0.01 }); }
    if (pathname.endsWith('/token') && new URLSearchParams(await req.text()).get('grant_type') === 'refresh_token' && rejectRefresh) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    if (pathname.endsWith('/token')) return pending ? Response.json({ error: 'authorization_pending' }, { status: 400 }) : Response.json({ access_token: `dummy-platform-access-${authorizations}`, refresh_token: `dummy-platform-refresh-${authorizations}`, token_type: 'Bearer', expires_in: 600 });
    if (pathname === '/opaque-credential') {
      if (req.method === 'POST') { present = true; ensures++; }
      return present ? Response.json({ key: 'dummy-cli-key' }) : Response.json({ error: 'key_missing' }, { status: 404 });
    }
    if (pathname.endsWith('/revoke')) { revocations++; return new Response(null); }
    return new Response(null, { status: 404 });
  } });
  t.after(() => server.stop(true));
  const url = `${server.url.origin}/team.json`;
  const added = await run(f, ['profile', 'add', url], [['Profile name [team]:', 'team'], ['Trust these gateways', 'yes']]);
  assert.equal(added.code, 0, added.output);
  assert.equal(added.stage, 2);
  assert.match(added.output, /OAuth issuer:/);
  assert.ok(!added.output.includes('Bifrost key (hidden)'));
  assert.ok(!added.output.includes('dummy-platform-access'));
  assert.equal(ensures, 1);
  assert.equal(f.run(['profile', 'use', 'team']).status, 0);
  const launched = await run(f, ['codex']);
  assert.equal(launched.code, 0, launched.output);
  assert.equal(ensures, 1);
  const readd = () => run(f, ['profile', 'add', url, '--auth=device'], [
    ['Profile name [team]:', 'team'], ['Update profile team URL and key?', 'yes'], ['Trust these gateways', 'yes'],
  ]);
  assert.equal((await readd()).code, 0);
  assert.equal(authorizations, 1, 'the same profile reuses its own valid session');
  const sessionDir = path.join(f.home, 'devn/oauth');
  const sessionFile = path.join(sessionDir, fs.readdirSync(sessionDir)[0]);
  const session = await Bun.file(sessionFile).json(); session.tokens.expires = 0;
  await Bun.write(sessionFile, JSON.stringify(session)); rejectRefresh = true;
  const renewed = await readd();
  assert.equal(renewed.code, 0, renewed.output);
  assert.equal(authorizations, 2, 'one re-add recovers invalid_grant and completes authorization');
  assert.equal(Bun.TOML.parse(await Bun.file(path.join(f.home, 'devn/config.toml')).text()).profiles.team.key, 'dummy-cli-key');
  const help = f.run(['profile', '--help']).stdout;
  assert.ok(!help.includes('profile login')); assert.ok(!help.includes('profile logout'));
  const removed = await run(f, ['profile', 'remove', 'team'], [['Type team to confirm removal:', 'team']]);
  assert.equal(removed.code, 0, removed.output);
  assert.equal(revocations, 1);
  assert.equal(present, true, 'the shared Bifrost key is not deleted');
  const unauthorized = await run(f, ['codex']);
  assert.equal(unauthorized.code, 1);
  assert.ok(!unauthorized.output.includes('profile logout'));
  const config = Bun.TOML.parse(await Bun.file(path.join(f.home, 'devn/config.toml')).text());
  assert.equal(config.profiles.team, undefined); assert.equal(config.projects[f.project], 'team');
  const manual = await run(f, ['profile', 'add', url, '--auth', 'manual'], [['Profile name [team]:', 'manual'], ['Trust these gateways', 'yes'], ['Bifrost key (hidden):', 'dummy-manual-key']]);
  assert.equal(manual.code, 0, manual.output);
  assert.equal((await run(f, ['profile', 'login', 'manual'])).code, 1);
  assert.equal(authorizations, 2);
  for (const args of [
    ['profile', 'login', 'team', '--auth', 'device'],
    ['profile', 'logout', 'manual'], ['profile', 'logout', 'team', '--auth', 'device'],
    ['profile', 'add', url, '--auth'], ['profile', 'login', 'a', 'b'],
    ['profile', 'login'], ['profile', 'logout'], ['login', 'team'], ['logout', 'team'],
  ]) assert.equal((await run(f, args)).code, 1);
  pending = true;
  const cancelled = await run(f, ['profile', 'add', url, '--auth', 'device'], [
    ['Profile name [team]:', 'team'], ['Trust these gateways', 'yes'],
  ], true);
  assert.notEqual(cancelled.code, 0);
  assert.ok(!cancelled.output.includes('dummy-platform-refresh'));
  assert.equal(Bun.TOML.parse(await Bun.file(path.join(f.home, 'devn/config.toml')).text()).profiles.team, undefined);
});
