import { expect, test } from 'bun:test';
import { downloadProfile } from '../src/download';
import { secureURL } from '../src/urls';

test('URL policy accepts HTTPS and literal loopback, rejects credentials and non-loopback HTTP', () => {
  for (const url of ['https://gateway.test', 'http://127.0.0.1:8080', 'http://localhost:8080', 'http://[::1]:8080']) {
    expect(() => secureURL(url)).not.toThrow();
  }
  for (const url of ['http://gateway.test', 'http://localhost.attacker.test', 'https://user:secret@gateway.test', 'file:///tmp/profile']) {
    expect(() => secureURL(url)).toThrow();
  }
});

test('HTTPS redirects cannot downgrade even to a loopback URL', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    calls++;
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
    expect(init?.redirect).toBe('manual');
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/profile.json' } });
  }) as typeof fetch;
  try {
    await expect(downloadProfile('https://config.example.test/profile.json', 'a')).rejects.toThrow('downgrade');
    expect(calls).toBe(1);
  } finally { globalThis.fetch = original; }
});
