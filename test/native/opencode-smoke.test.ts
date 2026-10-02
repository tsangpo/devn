import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, write } from '../helpers';
import { openCodeCommand, openCodeEnvironment } from '../../src/opencode';
import { platform } from '../../src/platform';

// Explicit opt-in suite: installed OpenCode v2, local gateway, dummy credentials.
test('OpenCode v2 uses the isolated catalog, bearer key, upstream model and Chat Completions', { timeout: 120000 }, async t => {
  const f = fixture(t);
  const requests: { url: string; key: string | null; body: any }[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url).pathname;
    const body = await req.json();
    requests.push({ url, key: req.headers.get('authorization'), body });
    if (url !== '/openai/v1/chat/completions') return new Response('Unexpected endpoint', { status: 400 });
    if (!body.stream) return Response.json({ id: 'chat-test', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'DEVN_OPENCODE_OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'chat-test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk({ role: 'assistant', content: 'DEVN_OPENCODE_OK' }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  t.after(() => server.stop(true));
  f.a.baseUrl = `http://127.0.0.1:${server.port}`;
  f.a.opencode = { model: 'coding', models: { coding: { modelID: 'gateway/upstream-coder', name: 'Local coding',
    limit: { context: 32768, output: 1024 } } } };
  write(path.join(f.home, 'devn/profiles/a/profile.json'), f.a);
  f.init('a', 'devn-opencode-dummy-key');
  assert.equal(f.run(['profile', 'use', 'a']).status, 0);
  // Neither direct nor .opencode project config may replace the provider/model.
  const conflicting = { model: 'evil/model', providers: { bifrost: { settings: { baseURL: 'http://127.0.0.1:1/trap', apiKey: 'wrong' } }, evil: { package: '@opencode/ai/providers/openai-compatible', models: { model: {} } } } };
  write(path.join(f.project, 'opencode.json'), conflicting);
  write(path.join(f.project, '.opencode/opencode.json'), conflicting);

  async function client(args: string[]) {
    const child = f.start(['opencode', ...args], { env: {
      ...f.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(conflicting), OPENCODE_DB: '/must-not-use.db',
    } });
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    t.after(() => child.kill('SIGKILL'));
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.stdin.end();
    const code = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timer);
    assert.equal(code, 0, stderr.replaceAll('devn-opencode-dummy-key', '[redacted]').slice(-5000));
    assert.ok(!stdout.includes('devn-opencode-dummy-key') && !stderr.includes('devn-opencode-dummy-key'));
    return stdout;
  }
  const diagnostic = await client(['debug', 'config']);
  const models = await client(['models']);
  assert.deepEqual(models.trim().split(/\r?\n/), ['bifrost/coding'], diagnostic);
  const output = await client(['run', '--model', 'bifrost/coding', 'Reply DEVN_OPENCODE_OK. Do not use tools.']);
  assert.match(output, /DEVN_OPENCODE_OK/);
  assert.ok(requests.length > 0);
  for (const req of requests) {
    assert.equal(req.url, '/openai/v1/chat/completions');
    assert.equal(req.key, 'Bearer devn-opencode-dummy-key');
    assert.equal(req.body.model, 'gateway/upstream-coder');
  }
  const database = (await client(['debug', 'paths', 'db'])).trim();
  assert.ok(database.startsWith(path.join(f.home, 'devn/profiles/a/opencode/data')));
  assert.ok(fs.existsSync(database));
  const configs = await client(['debug', 'config']);
  assert.ok(!configs.includes(path.join(f.project, 'opencode.json')));
  assert.ok(!configs.includes(path.join(f.project, '.opencode')));

  // Inspect the actual native catalog after plugin settlement as well as devn's
  // manifest listing. v2 model.list is explicitly an instantaneous snapshot.
  const env = openCodeEnvironment(path.join(f.home, 'devn/profiles/a'), f.env);
  env.OPENCODE_PASSWORD = 'devn-local-server-only';
  const nativeServer = Bun.spawn(platform.resolveCommand(openCodeCommand(env), ['serve', '--stdio', '--port', '0'], env), {
    cwd: f.project, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  const logs = new Response(nativeServer.stderr).text();
  const timeout = setTimeout(() => nativeServer.kill(), 20000);
  try {
    const reader = nativeServer.stdout.getReader();
    let text = '';
    while (!text.includes('\n')) {
      const chunk = await reader.read();
      assert.ok(!chunk.done, 'Native server exited before announcing its address');
      text += new TextDecoder().decode(chunk.value);
    }
    reader.releaseLock();
    const { url } = JSON.parse(text.split('\n')[0]);
    let catalog: any[] = [];
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const response = await fetch(`${url}/api/model`, { headers: { authorization: `Basic ${Buffer.from('opencode:devn-local-server-only').toString('base64')}` } });
      if (response.ok) catalog = (await response.json()).data;
      if (catalog.some(model => model.providerID === 'bifrost')) break;
      await Bun.sleep(100);
    }
    assert.deepEqual(catalog.map(model => `${model.providerID}/${model.id}`), ['bifrost/coding']);
    assert.deepEqual(catalog[0].capabilities, { tools: true, input: ['text', 'image'], output: ['text'] });
  } finally {
    nativeServer.stdin.end();
    await nativeServer.exited;
    clearTimeout(timeout);
    await logs;
  }
});
