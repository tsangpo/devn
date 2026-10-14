import { testPlatform } from '../platform';
import * as tempFS from 'node:fs';
import * as tempOS from 'node:os';
import * as tempPath from 'node:path';
// Optional integration test: real installed clients, local HTTP server, dummy key only.
import { realpathSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

const root = Bun.fileURLToPath(new URL('../../', import.meta.url));
let temp: string;
let repo: string;
let home: string;
let project: string;
let server: ReturnType<typeof Bun.serve>;
const requests: { url: string; authorization: string | null; body: Record<string, any> }[] = [];
const children = new Set<ReturnType<typeof Bun.spawn>>();
const key = 'devn-local-smoke-test-only';
// Bifrost /v1/models shape: provider-prefixed IDs plus optional metadata.
const discovered: Record<string, unknown>[] = [
  { id: 'bedrock/global.anthropic.claude-smoke', name: 'Claude smoke', context_length: 200000, max_output_tokens: 8192 },
  { id: 'bedrock/global.openai.gpt-smoke', name: 'GPT smoke', context_length: 128000, architecture: { input_modalities: ['text', 'image'] } },
  // Matches a slug in the Codex bundled catalog, so it inherits that model's settings.
  { id: 'bedrock/global.openai.gpt-6.1-sol' },
];

function event(response, type, body) {
  response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
}
function startGateway() { return Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(req) {
    const text = await req.text();
    const body = text ? JSON.parse(text) : {};
    const request = { url: new URL(req.url).pathname };
    if (request.url === '/profile.json') {
      expect(req.headers.get('authorization')).toBeNull();
      return Response.json(await Bun.file(`${repo}/profiles/smoke.json`).json());
    }
    requests.push({ url: request.url, authorization: req.headers.get('authorization'), body });
    if (request.url === '/v1/models') return Response.json({ data: discovered });
    const chunks: string[] = [];
    const headers = new Headers();
    const response = {
      statusCode: 200,
      write(chunk: string) { chunks.push(chunk); },
      setHeader(name: string, value: string) { headers.set(name, value); },
      end(chunk = '') { chunks.push(chunk); },
    };
    respond(request, response, body);
    return new Response(chunks.join(''), { status: response.statusCode, headers });
  },
}); }

function respond(request, response, body) {
  if (request.url.includes('count_tokens')) {
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ input_tokens: 100 })); return;
  }
  if (request.url.startsWith('/openai/v1/responses')) {
    response.setHeader('content-type', 'text/event-stream');
    const item = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'DEVN_NATIVE_OK', annotations: [] }] };
    const result = { id: 'resp_test', object: 'response', created_at: 1, model: body.model, status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } };
    event(response, 'response.created', { response: { ...result, status: 'in_progress', output: [] } });
    event(response, 'response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    event(response, 'response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    event(response, 'response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'DEVN_NATIVE_OK' });
    event(response, 'response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: 'DEVN_NATIVE_OK' });
    event(response, 'response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
    event(response, 'response.output_item.done', { output_index: 0, item });
    event(response, 'response.completed', { response: result }); response.end(); return;
  }
  if (request.url.startsWith('/anthropic/v1/messages')) {
    const message = { id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'DEVN_NATIVE_OK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 5 } };
    if (!body.stream) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(message)); return; }
    response.setHeader('content-type', 'text/event-stream');
    event(response, 'message_start', { message: { ...message, content: [], stop_reason: null } });
    event(response, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    event(response, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'DEVN_NATIVE_OK' } });
    event(response, 'content_block_stop', { index: 0 });
    event(response, 'message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    event(response, 'message_stop', {}); response.end(); return;
  }
  response.statusCode = 404; response.end('{}');
}

async function client(tool, args) {
  const start = requests.length;
  const child = Bun.spawn([process.execPath, `${repo}/bin/devn`, tool, ...args], {
    cwd: project,
    env: { ...testPlatform.environment(), XDG_CONFIG_HOME: home, DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  children.add(child);
  const timer = setTimeout(() => stopChild(child), 45000);
  let exit: number, stdout: string, stderr: string;
  try {
    [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
  } finally { clearTimeout(timer); children.delete(child); }
  expect(exit, `${tool} failed: ${stderr.replaceAll(key, '[redacted]').slice(-4000)}`).toBe(0);
  expect(stdout).toContain('DEVN_NATIVE_OK');
  expect(stdout.includes(key) || stderr.includes(key)).toBe(false);
  const request = requests.slice(start).find(r => r.url.startsWith(tool === 'codex' ? '/openai/v1/responses' : '/anthropic/v1/messages') && !r.url.includes('count_tokens'));
  expect(request, `${tool} did not reach the local gateway`).toBeDefined();
  expect(request!.authorization).toBe(`Bearer ${key}`);
  expect(request!.body.model).toBeTruthy();
  console.log(`${tool}: model ${request.body.model}, bearer auth, endpoint, and streaming verified`);
  return { request: request!, stdout, stderr };
}

function stopChild(child: ReturnType<typeof Bun.spawn>) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

const codexArgs = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', 'Reply with DEVN_NATIVE_OK. Do not use tools.'];

describe('native clients through the local Bifrost gateway', () => {
  beforeEach(async () => {
    temp = '';
    temp = tempFS.realpathSync.native(tempFS.mkdtempSync(tempPath.join(tempOS.tmpdir(), 'devn-test-')));
    repo = `${temp}/cli`;
    home = `${temp}/home`;
    project = `${temp}/project`;
    requests.length = 0;
    server = startGateway();
    for (const directory of [repo, project, home + '/devn', repo + '/profiles']) tempFS.mkdirSync(directory, { recursive: true });
    for (const directory of ['src', 'bin']) tempFS.cpSync(tempPath.join(root, directory), tempPath.join(repo, directory), { recursive: true });
    await Bun.write(`${repo}/profiles/example.json`, Bun.file(`${root}/profiles/example.json`));
    await Bun.write(`${repo}/profiles/oauth.example.json`, Bun.file(`${root}/profiles/oauth.example.json`));
    await Bun.write(`${repo}/package.json`, Bun.file(`${root}/package.json`));
    await Bun.write(`${repo}/profiles/smoke.json`, JSON.stringify({ version: 1, id: 'smoke', name: 'Smoke', baseUrl: `http://127.0.0.1:${server.port}`, codex: {}, claude: {} }));
    await Bun.write(`${home}/devn/config.toml`, Bun.TOML.stringify({ version: 3, profiles: { smoke: { url: `http://127.0.0.1:${server.port}/profile.json`, key, origins: { codex: `http://127.0.0.1:${server.port}`, claude: `http://127.0.0.1:${server.port}` } } }, projects: { [realpathSync.native(project)]: 'smoke' } }));
    const { platform } = await import('../../src/platform');
    platform.privateFile(home + '/devn/config.toml');
  });

  afterEach(async () => {
    for (const child of children) stopChild(child);
    await Promise.all([...children].map(child => child.exited));
    children.clear();
    await server?.stop(true);
    if (temp) tempFS.rmSync(temp, { recursive: true, force: true });
  });

  test.serial('Codex uses a model discovered from the gateway', async () => {
    const { request } = await client('codex', codexArgs);
    expect(request.body.model).toBe('bedrock/global.openai.gpt-smoke');
    expect(requests.find(r => r.url === '/v1/models')!.authorization).toBe(`Bearer ${key}`);
    // Codex itself must read the generated switch that keeps its shared daemon off.
    const features = Bun.spawnSync(['codex', 'features', 'list'], { cwd: project,
      env: { ...testPlatform.environment(), CODEX_HOME: `${home}/devn/profiles/smoke/codex` }, stdout: 'pipe', stderr: 'pipe' });
    expect(features.stdout.toString()).toMatch(/^daemon_auto_start\s+\S+\s+false$/m);
  }, 50000);

  test.serial('Codex accepts bundled-catalog and non-OpenAI discovered models', async () => {
    for (const model of ['bedrock/global.openai.gpt-6.1-sol', 'bedrock/global.anthropic.claude-smoke']) {
      const { request } = await client('codex', ['-m', model, ...codexArgs]);
      expect(request.body.model).toBe(model);
    }
    const catalog = await Bun.file(`${home}/devn/profiles/smoke/codex/models.json`).json();
    const known = catalog.models.find((m: any) => m.slug === 'bedrock/global.openai.gpt-6.1-sol');
    expect(known.supported_reasoning_levels.length).toBeGreaterThan(0);
    expect(catalog.models.find((m: any) => m.slug === 'bedrock/global.anthropic.claude-smoke').supported_reasoning_levels).toEqual([]);
  }, 50000);

  test.serial('Claude uses a model discovered from the gateway', async () => {
    const { request, stdout, stderr } = await client('claude', ['-p', 'Reply with DEVN_NATIVE_OK. Do not use tools.']);
    expect(request.body.model).toBe('bedrock/global.anthropic.claude-smoke');
    expect(stdout + stderr).not.toContain("isn't described by this version's model catalog");
  }, 50000);

  test.serial('Codex loads the centrally configured model catalog', async () => {
    const profilePath = `${repo}/profiles/smoke.json`;
    const profile = await Bun.file(profilePath).json();
    // Keep protocol coverage independent of the administrator-facing example.
    profile.codex = {
      model: 'devn/native-smoke',
      models: [{
        slug: 'devn/native-smoke', display_name: 'Native smoke', description: 'Local gateway fixture',
        context_window: 128000, default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'medium', description: 'Balanced' }],
        base_instructions: 'Reply with DEVN_NATIVE_OK. Do not use tools.',
        shell_type: 'unified_exec', support_verbosity: false, apply_patch_tool_type: 'freeform',
        truncation_policy: { mode: 'tokens', limit: 10000 }, experimental_supported_tools: [],
        visibility: 'list', supported_in_api: true, priority: 1,
      }],
    };
    await Bun.write(profilePath, JSON.stringify(profile));
    await client('codex', codexArgs);
    expect(requests.find(request => request.url.startsWith('/openai/v1/responses'))!.body.model)
      .toBe(profile.codex.model);
  }, 50000);

  test.serial('Claude maps discovered tiers and runs opusplan by default', async () => {
    const original = discovered.splice(0, discovered.length,
      { id: 'bedrock/global.anthropic.claude-opus-5-5' }, { id: 'bedrock/global.anthropic.claude-sonnet-5-5' },
      { id: 'bedrock/global.anthropic.claude-haiku-4-5' }) as typeof discovered;
    try {
      for (const [mode, model] of [['default', 'bedrock/global.anthropic.claude-sonnet-5-5'], ['plan', 'bedrock/global.anthropic.claude-opus-5-5']]) {
        const result = await client('claude', ['--permission-mode', mode, '-p', 'Reply with DEVN_NATIVE_OK. Do not use tools.']);
        expect(result.request.body.model).toBe(model);
        expect(result.stdout + result.stderr).not.toContain("isn't described by this version's model catalog");
      }
      const settings = await Bun.file(`${home}/devn/profiles/smoke/claude/settings.json`).json();
      expect(settings.model).toBe('opusplan');
      expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('bedrock/global.anthropic.claude-haiku-4-5');
    } finally { discovered.splice(0, discovered.length, ...original); }
  }, 50000);

  test.serial('Claude loads centrally configured native model settings', async () => {
    const profilePath = `${repo}/profiles/smoke.json`;
    const profile = await Bun.file(profilePath).json();
    profile.claude = (await Bun.file(`${root}/profiles/example.json`).json()).claude;
    await Bun.write(profilePath, JSON.stringify(profile));
    for (const [mode, model] of [['default', profile.claude.slots.sonnet], ['plan', profile.claude.slots.opus]]) {
      const result = await client('claude', ['--permission-mode', mode, '-p', 'Reply with DEVN_NATIVE_OK. Do not use tools.']);
      expect(result.request.body.model).toBe(model);
      expect(result.stdout + result.stderr).not.toContain("isn't described by this version's model catalog");
    }
  }, 50000);

  test.serial('Claude honors profile env switches and still marks the prompt cache', async () => {
    const profilePath = `${repo}/profiles/smoke.json`;
    const profile = await Bun.file(profilePath).json();
    profile.claude = { env: { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' } };
    await Bun.write(profilePath, JSON.stringify(profile));
    const { request } = await client('claude', ['-p', 'Reply with DEVN_NATIVE_OK. Do not use tools.']);
    expect((request.body.tools || []).some((tool: any) => 'defer_loading' in tool)).toBe(false);
    expect(request.body.context_management).toBeUndefined();
    expect(JSON.stringify(request.body.system)).toContain('cache_control');
  }, 50000);
});
