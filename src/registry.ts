import { secureURL } from './urls';

export type Tool = 'codex' | 'claude';
export type Model = { id: string; name: string; description?: string; behavesAs?: string; metadata?: Record<string, any> };
export type Profile = {
  version: 1; id: string; name: string; baseUrl: string; example?: boolean;
  codex: { defaultModel?: string; baseUrl?: string; models?: Model[] };
  claude: { defaultModel?: string; baseUrl?: string; models?: Model[]; slots?: Partial<Record<'sonnet' | 'opus' | 'haiku', string>> };
};
export type Origins = Record<Tool, string>;
export type Registration = { id: string; name: string; url: string; key: string; origins?: Origins };
export type Registry = { profiles: Registration[] };
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function url(value: unknown): void {
  requireValue(typeof value === 'string', 'baseUrl must be a URL string.');
  const parsed = secureURL(value);
  requireValue(!parsed.search, 'baseUrl must not contain a query.');
}
function keys(value: Record<string, any>, allowed: string[], label: string): void {
  requireValue(Object.keys(value).every(key => allowed.includes(key)), `Unknown field in ${label}.`);
}

export function validateProfile(value: any, localId?: string): Profile {
  requireValue(object(value), 'Profile must be an object.');
  keys(value, ['version', 'id', 'name', 'baseUrl', 'example', 'codex', 'claude'], 'profile');
  requireValue(value.version === 1 && (value.id === undefined || validId(value.id)), 'Profile requires version 1 and an optional safe id.');
  requireValue(value.name === undefined || (typeof value.name === 'string' && value.name.trim()), 'Profile name must be nonempty.');
  requireValue(value.example === undefined || typeof value.example === 'boolean', 'example must be Boolean.');
  url(value.baseUrl);
  for (const tool of ['codex', 'claude'] as const) {
    const config = value[tool];
    requireValue(object(config), `${tool} configuration is required.`);
    keys(config, tool === 'claude' ? ['defaultModel', 'baseUrl', 'models', 'slots'] : ['defaultModel', 'baseUrl', 'models'], tool);
    if (config.baseUrl !== undefined) url(config.baseUrl);
    if (config.models === undefined) {
      requireValue(config.defaultModel === undefined && config.slots === undefined,
        `${tool}: defaultModel and slots require an explicit models list.`);
      continue;
    }
    requireValue(Array.isArray(config.models) && config.models.length > 0, `${tool}.models must not be empty.`);
    const ids = new Set<string>();
    for (const model of config.models) {
      requireValue(object(model), `${tool} model must be an object.`);
      keys(model, tool === 'codex' ? ['id', 'name', 'description', 'metadata'] : ['id', 'name', 'description', 'behavesAs'], `${tool} model`);
      requireValue(typeof model.id === 'string' && model.id.trim() && !/[\s\x00-\x1f]/.test(model.id), `${tool} model id is invalid.`);
      requireValue(!ids.has(model.id), `Duplicate ${tool} model id.`);
      ids.add(model.id);
      requireValue(typeof model.name === 'string' && model.name.trim(), `${tool} model name is required.`);
      requireValue(model.description === undefined || typeof model.description === 'string', 'Model description must be a string.');
      if (tool === 'codex') {
        requireValue(object(model.metadata), 'Codex models require native metadata (see profiles/example.json).');
        const meta = model.metadata;
        requireValue(Number.isInteger(meta.context_window) && meta.context_window > 0, 'Codex context_window must be positive.');
        requireValue(Array.isArray(meta.supported_reasoning_levels) && meta.supported_reasoning_levels.length > 0,
          'Codex supported_reasoning_levels is required.');
        requireValue(meta.supported_reasoning_levels.every((r: any) => object(r) && typeof r.effort === 'string' && typeof r.description === 'string'),
          'Codex reasoning levels require effort and description.');
        requireValue(meta.supported_reasoning_levels.some((r: any) => r.effort === meta.default_reasoning_level),
          'Codex default reasoning level must appear in supported_reasoning_levels.');
      } else {
        requireValue(model.behavesAs === undefined || typeof model.behavesAs === 'string', 'behavesAs must be a model ID.');
      }
    }
    requireValue(ids.has(config.defaultModel), `${tool}.defaultModel must appear in models.`);
    if (config.slots !== undefined) {
      requireValue(object(config.slots), 'Claude slots must be an object.');
      keys(config.slots, ['sonnet', 'opus', 'haiku'], 'claude.slots');
      requireValue(Object.values(config.slots).every(id => ids.has(id as string)), 'Claude slots must reference listed models.');
    }
  }
  return { ...value, id: localId || value.id || 'example', name: value.name || localId || value.id || 'Example' } as Profile;
}

export function endpoint(profile: Profile, tool: Tool): string {
  return (profile[tool].baseUrl || `${profile.baseUrl.replace(/\/+$/, '')}/${tool === 'codex' ? 'openai/v1' : 'anthropic'}`).replace(/\/+$/, '');
}

export function gatewayOrigins(profile: Profile): Origins {
  return { codex: new URL(endpoint(profile, 'codex')).origin, claude: new URL(endpoint(profile, 'claude')).origin };
}
