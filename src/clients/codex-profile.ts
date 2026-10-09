import { requireValue, object, keys, url } from './validation';

export type CodexModel = {
  slug: string; display_name: string; description: string; context_window?: number;
  default_reasoning_level?: string | null;
  supported_reasoning_levels?: { effort: string; description: string }[] | null;
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
    requireValue(model.context_window === undefined || (Number.isInteger(model.context_window) && model.context_window > 0), 'Codex context_window must be positive when present.');
    const levels = model.supported_reasoning_levels ?? [];
    const defaultLevel = model.default_reasoning_level ?? undefined;
    requireValue(Array.isArray(levels), 'Codex supported_reasoning_levels must be a list when present.');
    if (levels.length > 0) {
      requireValue(levels.every((r: unknown) => object(r) && typeof r.effort === 'string' && typeof r.description === 'string'),
        'Codex reasoning levels require effort and description.');
    }
    if (defaultLevel !== undefined) {
      requireValue(levels.length > 0 && typeof defaultLevel === 'string' && levels.some((r: { effort: string }) => r.effort === defaultLevel),
        'Codex default reasoning level must appear in supported_reasoning_levels.');
    }
  }
  requireValue(ids.has(config.model), 'codex.model must appear in the model list.');
}
