import { secureURL } from './urls';

export type OpenCodeModel = {
  name?: string; modelID?: string; family?: string;
  capabilities?: { tools: boolean; input: string[]; output: string[] };
  limit?: { context?: number; input?: number; output?: number };
  cost?: { input: number; output: number; cache?: { read?: number; write?: number } };
};
export type OpenCodeProfile = { baseUrl?: string; model: string; models: Record<string, OpenCodeModel> };

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`opencode: ${message}`);
}
function object(value: any, allowed?: string[]): asserts value is Record<string, any> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'expected an object.');
  requireValue(Object.keys(value).every(key => !['__proto__', 'constructor', 'prototype'].includes(key) && (!allowed || allowed.includes(key))), 'unknown or unsafe field.');
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && !!value && !/[\s\x00-\x1f\x7f-\x9f#{}]/.test(value);
}

export function validateOpenCode(value: unknown): asserts value is OpenCodeProfile {
  object(value, ['baseUrl', 'model', 'models']);
  // OpenCode expands these strings before validating config, even in model labels.
  requireValue(!/\{(?:env|file):/.test(JSON.stringify(value)), 'configuration substitutions are not allowed in remote profiles.');
  if (value.baseUrl !== undefined) {
    requireValue(typeof value.baseUrl === 'string' && !secureURL(value.baseUrl).search, 'baseUrl must be a URL without a query.');
  }
  object(value.models);
  requireValue(Object.keys(value.models).length > 0, 'models must not be empty.');
  for (const [id, model] of Object.entries(value.models)) {
    requireValue(identifier(id), 'invalid model ID.');
    object(model, ['name', 'modelID', 'family', 'capabilities', 'limit', 'cost']);
    for (const field of ['name', 'family']) {
      requireValue(model[field] === undefined || (typeof model[field] === 'string' && model[field].trim()), `${field} must be nonempty.`);
    }
    requireValue(model.modelID === undefined || identifier(model.modelID), 'invalid upstream modelID.');
    if (model.capabilities !== undefined) {
      object(model.capabilities, ['tools', 'input', 'output']);
      requireValue(typeof model.capabilities.tools === 'boolean', 'capabilities.tools must be Boolean.');
      for (const field of ['input', 'output']) requireValue(Array.isArray(model.capabilities[field]) && model.capabilities[field].every((v: unknown) => typeof v === 'string' && v.trim()), `capabilities.${field} must be an array of media types.`);
    }
    if (model.limit !== undefined) {
      object(model.limit, ['context', 'input', 'output']);
      requireValue(Object.values(model.limit).every(v => Number.isSafeInteger(v) && (v as number) > 0), 'model limits must be positive integers.');
    }
    if (model.cost !== undefined) {
      object(model.cost, ['input', 'output', 'cache']);
      const amounts = [model.cost.input, model.cost.output];
      if (model.cost.cache !== undefined) {
        object(model.cost.cache, ['read', 'write']);
        amounts.push(...Object.values(model.cost.cache));
      }
      requireValue(amounts.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0), 'costs must be finite, nonnegative numbers.');
    }
  }
  requireValue(identifier(value.model) && Object.hasOwn(value.models, value.model), 'model must appear in models.');
}
