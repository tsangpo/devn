import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, write } from '../helpers';
import { openCodeCommand, openCodeEnvironment } from '../../src/clients/opencode-runtime';
import { platform } from '../../src/platform';

// Explicit opt-in suite: installed OpenCode v2, local gateway, dummy credentials.
test('OpenCode v2 uses the isolated catalog, bearer key, upstream model and Responses', { timeout: 120000 }, async t => {
  const f = fixture(t);
  const requests: { url: string; key: string | null; body: any }[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url).pathname;
    const body = await req.json();
    requests.push({ url, key: req.headers.get('authorization'), body });
    if (url !== '/openai/v1/responses') return new Response('Unexpected endpoint', { status: 400 });
    const item = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'DEVN_OPENCODE_OK', annotations: [] }] };
    const result = { id: 'resp_test', object: 'response', created_at: 1, model: body.model, status: 'completed',
      output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    if (!body.stream) return Response.json(result);
    let sequence = 0;
    const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`;
    const location = { item_id: item.id, output_index: 0, content_index: 0 };
    return new Response([
      event('response.created', { response: { ...result, status: 'in_progress', output: [] } }),
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } }),
      event('response.content_part.added', { ...location, part: { type: 'output_text', text: '', annotations: [] } }),
      event('response.output_text.delta', { ...location, delta: 'DEVN_OPENCODE_OK' }),
      event('response.output_text.done', { ...location, text: 'DEVN_OPENCODE_OK' }),
      event('response.content_part.done', { ...location, part: item.content[0] }),
      event('response.output_item.done', { output_index: 0, item }),
      event('response.completed', { response: result }),
    ].join(''), { headers: { 'content-type': 'text/event-stream' } });
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
    assert.equal(req.url, '/openai/v1/responses');
    assert.equal(req.key, 'Bearer devn-opencode-dummy-key');
    assert.equal(req.body.model, 'gateway/upstream-coder');
    assert.ok(Array.isArray(req.body.input));
    assert.equal(req.body.messages, undefined);
    assert.equal(req.body.stream, true);
    assert.equal(req.body.store, false);
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
