import { requireValue, object, keys, url } from './validation';

export type ClaudeModel = { model: string; label: string; description?: string; behavesAs?: string };
export type ClaudeProfile = {
  model?: string; baseUrl?: string;
  modelPicker?: { replaceBuiltInOptions: boolean; options: ClaudeModel[] };
  slots?: Partial<Record<'sonnet' | 'opus' | 'haiku', string>>;
};

export function validateClaude(config: unknown): asserts config is ClaudeProfile {
  requireValue(object(config), 'claude configuration is required.');
  requireValue(config.defaultModel === undefined && config.models === undefined,
    'Legacy model format: use model, native codex.models entries, and claude.modelPicker (see profiles/example.json).');
  keys(config, ['model', 'baseUrl', 'modelPicker', 'slots'], 'claude');
  if (config.baseUrl !== undefined) url(config.baseUrl);
  if (config.modelPicker !== undefined) {
    requireValue(object(config.modelPicker), 'Claude modelPicker must be an object.');
    keys(config.modelPicker, ['replaceBuiltInOptions', 'options'], 'claude.modelPicker');
    requireValue(config.modelPicker.replaceBuiltInOptions === true,
      'Claude modelPicker.replaceBuiltInOptions must be true for an explicit model list.');
    requireValue(Array.isArray(config.modelPicker.options), 'Claude modelPicker.options must be an array.');
  }
  const models = config.modelPicker?.options;
  if (models === undefined) {
    requireValue(config.model === undefined && config.slots === undefined, 'claude: model and slots require an explicit model list.');
    return;
  }
  requireValue(models.length > 0, 'claude model list must not be empty.');
  const ids = new Set<string>();
  for (const model of models) {
    requireValue(object(model), 'claude model must be an object.');
    requireValue(typeof model.model === 'string' && model.model.trim() && !/[\s\x00-\x1f]/.test(model.model), 'claude model id is invalid.');
    requireValue(!ids.has(model.model), 'Duplicate claude model id.');
    ids.add(model.model);
    requireValue(typeof model.label === 'string' && model.label.trim(), 'claude model name is required.');
    requireValue(model.description === undefined || typeof model.description === 'string', 'Model description must be a string.');
    keys(model, ['model', 'label', 'description', 'behavesAs'], 'claude model');
    requireValue(model.behavesAs === undefined || typeof model.behavesAs === 'string', 'behavesAs must be a model ID.');
  }
  requireValue(ids.has(config.model), 'claude.model must appear in the model list.');
  if (config.slots !== undefined) {
    requireValue(object(config.slots), 'Claude slots must be an object.');
    keys(config.slots, ['sonnet', 'opus', 'haiku'], 'claude.slots');
    requireValue(Object.values(config.slots).every(id => ids.has(id as string)), 'Claude slots must reference listed models.');
  }
}
