import { assertTrusted, loadRegistry, lockProfile } from './store';
import fs from 'node:fs';
import path from 'node:path';
const { parse, stringify } = Bun.TOML;
import { atomicWrite, privateDir, privateFile, profileDir, readJson, writeJson } from './files';
import { endpoint, modelIds, type Profile, type Tool } from './registry';

type Data = Record<string, any>;
type KeyPath = string[];
const isObject = (value: any): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);

function paths(value: Data, prefix: string[] = []): KeyPath[] {
  return Object.entries(value).flatMap(([key, item]) => {
    const next = [...prefix, key];
    // The entire provider is owned, so obsolete auth methods cannot survive a merge.
    if (['model_providers.bifrost', 'providers.bifrost', 'modelPicker'].includes(next.join('.'))) return [next];
    return isObject(item) && Object.keys(item).length ? paths(item, next) : [next];
  });
}
function deleteAt(value: Data, keys: KeyPath): void {
  if (!keys.length || keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) return;
  let cursor = value;
  for (const key of keys.slice(0, -1)) {
    if (!isObject(cursor[key])) return;
    cursor = cursor[key];
  }
  delete cursor[keys.at(-1)!];
}
function merge(existing: Data, managed: Data): Data {
  const result = structuredClone(existing);
  for (const [key, value] of Object.entries(managed)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe configuration key.');
    result[key] = isObject(value) && isObject(result[key]) ? merge(result[key], value) : value;
  }
  return result;
}

function readConfig(file: string, tool: Tool): Data {
  if (!fs.existsSync(file)) return {};
  privateFile(file);
  try {
    const value = tool === 'codex' ? parse(fs.readFileSync(file, 'utf8')) : JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(value)) throw new Error();
    return value;
  } catch {
    // Never include parser exceptions: they can quote the embedded API key.
    throw new Error(`Invalid ${tool} configuration at ${file}. Repair it before launching; no files were overwritten.`);
  }
}

export async function generateConfig(profile: Profile, tool: Tool, apiKey: string): Promise<{ file: string; model?: string }> {
  const root = profileDir(profile.id);
  privateDir(root);
  const release = await lockProfile(profile.id);
  try {
    const entry = (await loadRegistry()).profiles.find(p => p.id === profile.id);
    if (!entry || entry.key !== apiKey) throw new Error('Profile changed before launch. Try again.');
    assertTrusted(entry, profile);
    for (const name of ['codex', 'claude']) privateDir(path.join(root, name));
    const dir = path.join(root, tool);
    privateDir(dir);
    if (tool === 'opencode' && fs.existsSync(path.join(dir, 'opencode.jsonc'))) {
      throw new Error('Use the profile opencode.json for local settings; opencode.jsonc would override managed configuration.');
    }
    const file = path.join(dir, tool === 'codex' ? 'config.toml' : tool === 'opencode' ? 'opencode.json' : 'settings.json');
    const existing = readConfig(file, tool);
    const definitions = profile[tool];
    if (!definitions) throw new Error('Add an opencode section with model and models to the remote profile first.');
    const defaultModel = tool === 'opencode' ? `bifrost/${definitions.model}` : definitions.model;
    const ids = modelIds(profile, tool);
    const model = ids
      ? (ids.includes(existing.model) ? existing.model : defaultModel)
      : undefined;
    if (ids && existing.model && model !== existing.model) console.error(`devn: saved ${tool} model is no longer listed; using ${model}.`);
    const catalog = path.join(root, 'codex', 'models.json');
    const managed: Data = {};
    if (model) managed.model = model;
    if (tool === 'codex') {
      managed.model_provider = 'bifrost';
      // Gateway model support does not imply support for OpenAI's hosted search.
      // Preserve an explicit user choice for gateways that do support it.
      managed.web_search = existing.web_search ?? 'disabled';
      if (ids) managed.model_catalog_json = catalog;
      managed.model_providers = {};
      managed.model_providers.bifrost = {
        name: 'Bifrost', base_url: endpoint(profile, tool),
        wire_api: 'responses', experimental_bearer_token: apiKey, requires_openai_auth: false, supports_websockets: false,
      };
    } else if (tool === 'opencode') {
      managed.providers = { bifrost: {
        name: 'Bifrost', package: '@opencode/ai/providers/openai-compatible',
        env: [], settings: { baseURL: endpoint(profile, tool), apiKey },
        models: profile.opencode!.models,
      } };
      if (existing.plugins !== undefined && !Array.isArray(existing.plugins)) throw new Error('Invalid OpenCode plugins.');
      managed.plugins = [...(existing.plugins || []).filter((p: unknown) => p !== '-opencode.config.compatibility'), '-opencode.config.compatibility'];
      const policies = existing.experimental?.policies;
      if (policies !== undefined && !Array.isArray(policies)) throw new Error('Invalid OpenCode policies.');
      managed.experimental = { policies: [
        ...(policies || []).filter((p: any) => p?.action !== 'provider.use'),
        { action: 'provider.use', resource: '*', effect: 'deny' },
        { action: 'provider.use', resource: 'bifrost', effect: 'allow' },
      ] };
    } else {
      managed.env = {
        ANTHROPIC_BASE_URL: endpoint(profile, tool), ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_API_KEY: '', CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_FOUNDRY: '0',
      };
      if (ids) {
        Object.assign(managed.env, {
          ANTHROPIC_DEFAULT_SONNET_MODEL: profile.claude.slots?.sonnet || definitions.model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: profile.claude.slots?.opus || definitions.model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.claude.slots?.haiku || definitions.model,
        });
        managed.modelPicker = profile.claude.modelPicker;
      }
    }
    const manifest = path.join(dir, '.devn-managed.json');
    const prior = fs.existsSync(manifest) ? readJson(manifest) : { paths: [] };
    if (!Array.isArray(prior.paths) || !prior.paths.every((p: any) => Array.isArray(p) && p.every((k: any) => typeof k === 'string'))) {
      throw new Error(`Invalid ownership metadata at ${manifest}.`);
    }
    const ownedPaths = paths(managed);
    for (const keyPath of [...prior.paths, ...ownedPaths]) {
      if (!ids && keyPath.length === 1 && keyPath[0] === 'model') continue;
      deleteAt(existing, keyPath);
    }
    const output = merge(existing, managed);
    let serialized: string;
    try { serialized = tool === 'codex' ? stringify(output) + '\n' : JSON.stringify(output, null, 2) + '\n'; }
    catch { throw new Error(`Cannot serialize ${tool} configuration; no configuration was written.`); }
    if (tool === 'codex' && ids) {
      writeJson(catalog, { models: profile.codex.models });
    }
    if (tool === 'opencode') {
      writeJson(path.join(dir, 'service.json'), { disabled: true });
      const cli = path.join(dir, 'cli.json');
      if (!fs.existsSync(cli)) writeJson(cli, {
        $schema: 'https://opencode.ai/v2/cli.json', theme: { name: 'system' },
      });
    }
    atomicWrite(file, serialized);
    writeJson(manifest, { version: 1, paths: ownedPaths });
    return { file, model };
  } finally { release(); }
}
