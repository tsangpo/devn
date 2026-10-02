import { requireValue, object, keys, url } from './validation';

export type CodexModel = {
  slug: string; display_name: string; description: string; context_window: number;
  default_reasoning_level: string;
  supported_reasoning_levels: { effort: string; description: string }[];
  [key: string]: unknown;
};
export type CodexProfile = { model?: string; baseUrl?: string; models?: CodexModel[] };

export function validateCodex(config: unknown): asserts config is CodexProfile {
  requireValue(object(config), 'codex configuration is required.');
  requireValue(config.defaultModel === undefined,
    'Legacy model format: use model, native codex.models entries, and claude.modelPicker (see profiles/example.json).');
  keys(config, ['model', 'baseUrl', 'models'], 'codex');
  if (config.baseUrl !== undefined) url(config.baseUrl);
  if (config.models === undefined) {
    requireValue(config.model === undefined, 'codex: model and slots require an explicit model list.');
    return;
  }
  requireValue(Array.isArray(config.models) && config.models.length > 0, 'codex model list must not be empty.');
  const ids = new Set<string>();
  for (const model of config.models) {
    requireValue(object(model), 'codex model must be an object.');
    requireValue(typeof model.slug === 'string' && model.slug.trim() && !/[\s\x00-\x1f]/.test(model.slug), 'codex model id is invalid.');
    requireValue(!ids.has(model.slug), 'Duplicate codex model id.');
    ids.add(model.slug);
    requireValue(typeof model.display_name === 'string' && model.display_name.trim(), 'codex model name is required.');
    requireValue(model.description === undefined || typeof model.description === 'string', 'Model description must be a string.');
    requireValue(typeof model.description === 'string', 'Codex description is required.');
    requireValue(Number.isInteger(model.context_window) && model.context_window > 0, 'Codex context_window must be positive.');
    requireValue(Array.isArray(model.supported_reasoning_levels) && model.supported_reasoning_levels.length > 0,
      'Codex supported_reasoning_levels is required.');
    requireValue(model.supported_reasoning_levels.every((r: unknown) => object(r) && typeof r.effort === 'string' && typeof r.description === 'string'),
      'Codex reasoning levels require effort and description.');
    requireValue(model.supported_reasoning_levels.some((r: { effort: string }) => r.effort === model.default_reasoning_level),
      'Codex default reasoning level must appear in supported_reasoning_levels.');
  }
  requireValue(ids.has(config.model), 'codex.model must appear in the model list.');
}
