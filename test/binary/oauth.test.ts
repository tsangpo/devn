import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostPlatform, targets } from '../../scripts/platform';
import { testPlatform } from '../platform';

test('standalone OAuth profile add and automatic session retirement work without Bun on PATH', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const target = hostPlatform();
  const binary = path.join(root, 'release', target, targets[target].executable);
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'devn-binary-oauth-')));
  const requests: string[] = [];
  const id = '00000000-0000-4000-8000-000000000001';
  let profile: any;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const pathname = new URL(req.url).pathname;
    requests.push(pathname);
    const origin = server.url.origin, issuer = `${origin}/api/auth`;
    if (pathname === '/profile.json') return Response.json(profile);
    if (pathname.startsWith('/.well-known/')) return Response.json({ issuer, code_challenge_methods_supported: ['S256'], authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token`, device_authorization_endpoint: `${issuer}/device/code`, revocation_endpoint: `${issuer}/oauth2/revoke` });
    if (pathname.endsWith('/device/code')) return Response.json({ device_code: 'dummy-device', user_code: 'DUMMY-CODE', verification_uri: `${origin}/device`, expires_in: 60, interval: 0.01 });
    if (pathname.endsWith('/token')) {
      const body = new URLSearchParams(await req.text());
      expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
      return Response.json({ token_type: 'Bearer', access_token: 'dummy-binary-access', refresh_token: 'dummy-binary-refresh', expires_in: 600 });
    }
    if (pathname.endsWith('/key')) return Response.json({ value: 'dummy-binary-key', user: { id: 'dummy-subject', email: 'dummy@example.test', name: 'Dummy' }, instanceId: id });
    if (pathname.endsWith('/revoke')) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  } });
  try {
    const origin = server.url.origin;
    const auth = { type: 'oauth2', issuer: `${origin}/api/auth`, clientId: 'cli', resource: `${origin}/opaque/binary/key?test=1` };
    profile = { version: 1, id: 'smoke', baseUrl: origin, auth, codex: {}, claude: {} };
    const home = path.join(temp, 'config');
    const file = path.join(home, 'devn/config.toml');
    await Bun.write(file, Bun.TOML.stringify({ version: 3, profiles: {}, projects: {} }));
    await Bun.write(path.join(home, 'devn/profiles/smoke/profile.json'), JSON.stringify(profile));
    const env = { ...testPlatform.environment(), PATH: temp, XDG_CONFIG_HOME: home, SSH_CONNECTION: 'dummy-ssh' };
    async function run(args: string[], answers: [string, string][] = []) {
      let output = '', stage = 0;
      const child = Bun.spawn([binary, ...args], { cwd: temp, env,
        terminal: { cols: 180, rows: 40, data(terminal, bytes) {
          output += Bun.stripANSI(new TextDecoder().decode(bytes));
          if (stage < answers.length && output.includes(answers[stage][0])) terminal.write(answers[stage++][1] + testPlatform.enter);
        } },
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      try {
        expect(await child.exited).toBe(0);
        expect(stage).toBe(answers.length);
        expect(output).not.toContain('dummy-binary-access');
        expect(output).not.toContain('dummy-binary-refresh');
        return output;
      } finally { clearTimeout(timer); child.terminal.close(); }
    }
    expect(await run(['profile', 'add', `${origin}/profile.json`, '--auth', 'device'], [
      ['Profile name [profile]:', 'smoke'], ['Trust these gateways', 'yes'],
    ])).toContain('DUMMY-CODE');
    expect(Bun.TOML.parse(await Bun.file(file).text()).profiles.smoke.key).toBe('dummy-binary-key');
    await run(['profile', 'use', 'smoke']);
    expect(requests.some(p => p.endsWith('/me'))).toBe(false);
    expect(await run(['profile', 'remove', 'smoke'], [['Type smoke to confirm removal:', 'smoke']])).not.toContain('not confirmed');
    expect(Bun.TOML.parse(await Bun.file(file).text()).profiles.smoke).toBeUndefined();
    expect(requests).toContain('/api/auth/oauth2/token');
    expect(requests).toContain('/api/auth/oauth2/revoke');
  } finally { await server.stop(true); fs.rmSync(temp, { recursive: true, force: true }); }
}, testPlatform.timeout);
