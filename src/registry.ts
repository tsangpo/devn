import { secureURL } from './urls';

export type Tool = 'codex' | 'claude';
export type CodexModel = {
  slug: string;
  display_name: string;
  description: string;
  context_window: number;
  default_reasoning_level: string;
  supported_reasoning_levels: { effort: string; description: string }[];
  [key: string]: unknown;
};
export type ClaudeModel = { model: string; label: string; description?: string; behavesAs?: string };
export type Profile = {
  version: 1; id: string; name: string; baseUrl: string; example?: boolean;
  codex: { model?: string; baseUrl?: string; models?: CodexModel[] };
  claude: { model?: string; baseUrl?: string; modelPicker?: { replaceBuiltInOptions: boolean; options: ClaudeModel[] }; slots?: Partial<Record<'sonnet' | 'opus' | 'haiku', string>> };
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
    requireValue(config.defaultModel === undefined && !(tool === 'claude' && config.models !== undefined),
      'Legacy model format: use model, native codex.models entries, and claude.modelPicker (see profiles/example.json).');
    keys(config, tool === 'claude' ? ['model', 'baseUrl', 'modelPicker', 'slots'] : ['model', 'baseUrl', 'models'], tool);
    if (config.baseUrl !== undefined) url(config.baseUrl);
    if (tool === 'claude' && config.modelPicker !== undefined) {
      requireValue(object(config.modelPicker), 'Claude modelPicker must be an object.');
      keys(config.modelPicker, ['replaceBuiltInOptions', 'options'], 'claude.modelPicker');
      requireValue(config.modelPicker.replaceBuiltInOptions === true,
        'Claude modelPicker.replaceBuiltInOptions must be true for an explicit model list.');
      requireValue(Array.isArray(config.modelPicker.options), 'Claude modelPicker.options must be an array.');
    }
    const models = tool === 'codex' ? config.models : config.modelPicker?.options;
    if (models === undefined) {
      requireValue(config.model === undefined && config.slots === undefined,
        `${tool}: model and slots require an explicit model list.`);
      continue;
    }
    requireValue(Array.isArray(models) && models.length > 0, `${tool} model list must not be empty.`);
    const ids = new Set<string>();
    for (const model of models) {
      requireValue(object(model), `${tool} model must be an object.`);
      const id = tool === 'codex' ? model.slug : model.model;
      const name = tool === 'codex' ? model.display_name : model.label;
      requireValue(typeof id === 'string' && id.trim() && !/[\s\x00-\x1f]/.test(id), `${tool} model id is invalid.`);
      requireValue(!ids.has(id), `Duplicate ${tool} model id.`);
      ids.add(id);
      requireValue(typeof name === 'string' && name.trim(), `${tool} model name is required.`);
      requireValue(model.description === undefined || typeof model.description === 'string', 'Model description must be a string.');
      if (tool === 'codex') {
        requireValue(typeof model.description === 'string', 'Codex description is required.');
        requireValue(Number.isInteger(model.context_window) && model.context_window > 0, 'Codex context_window must be positive.');
        requireValue(Array.isArray(model.supported_reasoning_levels) && model.supported_reasoning_levels.length > 0,
          'Codex supported_reasoning_levels is required.');
        requireValue(model.supported_reasoning_levels.every((r: any) => object(r) && typeof r.effort === 'string' && typeof r.description === 'string'),
          'Codex reasoning levels require effort and description.');
        requireValue(model.supported_reasoning_levels.some((r: any) => r.effort === model.default_reasoning_level),
          'Codex default reasoning level must appear in supported_reasoning_levels.');
      } else {
        keys(model, ['model', 'label', 'description', 'behavesAs'], 'claude model');
        requireValue(model.behavesAs === undefined || typeof model.behavesAs === 'string', 'behavesAs must be a model ID.');
      }
    }
    requireValue(ids.has(config.model), `${tool}.model must appear in the model list.`);
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

export function modelIds(profile: Profile, tool: Tool): string[] | undefined {
  return tool === 'codex' ? profile.codex.models?.map(m => m.slug) : profile.claude.modelPicker?.options.map(m => m.model);
}
