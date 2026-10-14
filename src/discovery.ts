import path from 'node:path';
import { clients, getClient } from './clients';
import { atomicWrite, privateDir, profileDir, readJson } from './files';
import { readLimitedJson, Unavailable } from './download';
import { validateProfile } from './profile';
import { lockProfile } from './store';
import type { CodexModel } from './clients/codex-profile';
import { bundledCodexCatalog, codexCatalog } from './clients/codex-catalog';
import type { OpenCodeModel } from './clients/opencode-profile';
import type { LocalConfig, Profile, Tool } from './types';

// Only these gateway fields are read. Everything else in the response is ignored.
export type DiscoveredModel = {
  id: string; name?: string; description?: string;
  context?: number; input?: number; output?: number; images?: boolean;
};

const MAX_MODELS = 500;
const MAX_PAGES = 10;
const cacheFile = (id: string) => path.join(profileDir(id), 'models.json');

// Native loaders may expand templates even in labels, so reject them in every kept string.
const unsafeText = (value: string) => /[\x00-\x1f\x7f-\x9f]|\{(?:env|file):/.test(value);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s#{}]/.test(value) && !unsafeText(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() && !unsafeText(value) ? value.trim().slice(0, 200) : undefined;
const count = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;

function normalize(entries: unknown[]): DiscoveredModel[] {
  const models = new Map<string, DiscoveredModel>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const value = entry as Record<string, any>;
    if (!validId(value.id) || value.is_deprecated === true || models.has(value.id)) continue;
    const modalities = value.architecture?.input_modalities;
    const model: DiscoveredModel = {
      id: value.id, name: text(value.name), description: text(value.description),
      context: count(value.context_length), input: count(value.max_input_tokens), output: count(value.max_output_tokens),
      images: Array.isArray(modalities) ? modalities.includes('image') : undefined,
    };
    models.set(model.id, Object.fromEntries(Object.entries(model).filter(([, v]) => v !== undefined)) as DiscoveredModel);
    if (models.size >= MAX_MODELS) break;
  }
  return [...models.values()];
}

// A missing model list means "ask the gateway". Explicit lists always win, and only the
// launched client matters, so gateway problems never block a client with its own list.
export function needsDiscovery(profile: Profile, tool: Tool): boolean {
  return profile[tool] !== undefined && getClient(tool).models(profile).ids === undefined;
}

async function fetchModels(base: string, key: string): Promise<DiscoveredModel[]> {
  const signal = AbortSignal.timeout(10000);
  const entries: unknown[] = [];
  let token = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${base}/v1/models`);
    if (token) url.searchParams.set('page_token', token);
    let response: Response;
    try {
      // Never follow redirects: the key must reach only the approved origin.
      response = await fetch(url, { signal, redirect: 'manual', headers: { Accept: 'application/json', Authorization: `Bearer ${key}` } });
    } catch { throw new Unavailable('Gateway model list is unavailable or timed out.'); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 500) throw new Unavailable(`Gateway model list returned HTTP ${response.status}.`);
      throw new Error(`Gateway model list returned HTTP ${response.status}; launch cancelled.`);
    }
    const value: any = await readLimitedJson(response, 'Gateway model list');
    if (!value || typeof value !== 'object' || !Array.isArray(value.data)) throw new Error('Gateway returned an invalid model list.');
    entries.push(...value.data);
    token = typeof value.next_page_token === 'string' ? value.next_page_token : '';
    if (!token || entries.length >= MAX_MODELS) break;
  }
  return normalize(entries);
}

function readCache(id: string): DiscoveredModel[] {
  const value = readJson(cacheFile(id));
  if (value?.version !== 1 || !Array.isArray(value.models)) throw new Error();
  return normalize(value.models.map((m: DiscoveredModel) => ({
    id: m.id, name: m.name, description: m.description, context_length: m.context,
    max_input_tokens: m.input, max_output_tokens: m.output,
    ...(m.images === undefined ? {} : { architecture: { input_modalities: m.images ? ['text', 'image'] : ['text'] } }),
  })));
}

// Refreshes the gateway model list on every launch; temporary outages reuse the last list.
export async function discoverModels(profile: Profile, tool: Tool, entry: LocalConfig['profiles'][number], key: string): Promise<DiscoveredModel[]> {
  if (!needsDiscovery(profile, tool)) return [];
  const base = profile.baseUrl.replace(/\/+$/, '');
  if (!Object.values(entry.origins || {}).includes(new URL(base).origin)) {
    throw new Error('Model discovery requires the profile baseUrl origin to be an approved gateway. Run devn profile add to review it.');
  }
  let models: DiscoveredModel[];
  try { models = await fetchModels(base, key); }
  catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    try { models = readCache(profile.id); }
    catch { throw new Error(`${error.message} No cached model list is available for ${profile.id}.`); }
    if (!models.length) throw new Error(`${error.message} No cached model list is available for ${profile.id}.`);
    return models;
  }
  if (!models.length) throw new Error('Gateway returned no usable models for this key.');
  const release = await lockProfile(profile.id);
  try {
    privateDir(profileDir(profile.id));
    atomicWrite(cacheFile(profile.id), JSON.stringify({ version: 1, models }, null, 2) + '\n');
  } finally { release(); }
  return models;
}

function preferred(models: DiscoveredModel[], pattern: RegExp): string {
  return (models.find(m => pattern.test(m.id)) || models[0]).id;
}

// Version numbers in a route ID, ignoring release dates and Bedrock -v1:0 suffixes:
// bedrock/global.anthropic.claude-opus-5-5 -> [5, 5]; claude-3-5-sonnet-20241022 -> [3, 5].
function version(id: string): number[] {
  const name = id.slice(id.lastIndexOf('/') + 1).replace(/-\d{8}.*$/, '').replace(/-v\d+(?::\d+)?$/, '');
  return (name.match(/\d+/g) || []).map(Number);
}
function newer(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
  return 0;
}

// Newest model per Claude tier. Equal versions keep gateway order (e.g. global. before us.).
function claudeTiers(models: DiscoveredModel[]): Partial<Record<'opus' | 'sonnet' | 'haiku', string>> {
  const tiers: Partial<Record<'opus' | 'sonnet' | 'haiku', string>> = {};
  for (const tier of ['opus', 'sonnet', 'haiku'] as const) {
    const found = models.filter(m => new RegExp(`claude.*${tier}|${tier}.*claude`, 'i').test(m.id))
      .sort((a, b) => newer(version(a.id), version(b.id)));
    if (found.length) tiers[tier] = found[0].id;
  }
  return tiers;
}

function openCodeModel(model: DiscoveredModel): OpenCodeModel {
  const limit = Object.fromEntries(Object.entries({ context: model.context, input: model.input, output: model.output }).filter(([, v]) => v));
  return { ...(model.name ? { name: model.name } : {}), ...(Object.keys(limit).length ? { limit } : {}) };
}

// Returns the effective profile for one launch. The cached remote profile is not changed.
// Codex entries are generated only when its bundled catalog is supplied (Codex launches).
export function withDiscoveredModels(profile: Profile, models: DiscoveredModel[], codexBundled?: CodexModel[]): Profile {
  if (!models.length) return profile;
  const effective: any = structuredClone(profile);
  if (!effective.codex.models && codexBundled) {
    effective.codex.models = codexCatalog(models, codexBundled);
    effective.codex.model = preferred(models, /openai|gpt/i);
  }
  if (!effective.claude.modelPicker) {
    const options = models.map(m => ({ model: m.id, label: m.name || m.id, ...(m.description ? { description: m.description } : {}) }));
    const { opus, sonnet, haiku } = claudeTiers(models);
    effective.claude.model = preferred(models, /anthropic|claude/i);
    if (opus || sonnet || haiku) {
      // Every tier is set: a missing one would otherwise fall back to the default model, even opusplan.
      effective.claude.slots = { opus: opus || sonnet || haiku, sonnet: sonnet || opus || haiku, haiku: haiku || sonnet || opus };
      effective.claude.model = sonnet || opus || haiku;
    }
    if (opus && sonnet) {
      // Claude Code's built-in alias: the opus tier while planning, the sonnet tier otherwise.
      options.unshift({ model: 'opusplan', label: 'Opus Plan', description: 'Opus in plan mode, Sonnet for implementation. Recommended default' });
      effective.claude.model = 'opusplan';
    }
    effective.claude.modelPicker = { replaceBuiltInOptions: true, options };
  }
  if (effective.opencode && !effective.opencode.models) {
    effective.opencode.models = Object.fromEntries(models.map(m => [m.id, openCodeModel(m)]));
    effective.opencode.model = preferred(models, /openai|gpt/i);
  }
  // Generated sections must satisfy the same validators as hand-written profiles.
  return validateProfile(effective, profile.id);
}

// Probe the installed Codex with the same isolated environment its launch uses.
export function codexBundledCatalog(id: string): CodexModel[] {
  const env = { ...process.env };
  for (const client of clients) client.clearEnvironment?.(env);
  return bundledCodexCatalog(profileDir(id), env);
}
