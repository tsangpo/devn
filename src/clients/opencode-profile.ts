import { secureURL } from '../urls';

// Model entries are copied into opencode.json as written; see validateOpenCode for the few limits.
export type OpenCodeModel = Record<string, any> & {
  package?: string;
  settings?: Record<string, unknown> & { baseURL?: string };
};
// Omitting model and models asks devn to discover them from the gateway at launch.
export type OpenCodeProfile = { baseUrl?: string; model?: string; models?: Record<string, OpenCodeModel> };

export function openCodeModels(profile?: OpenCodeProfile): string[] | undefined {
  return profile?.models && Object.keys(profile.models).map(id => `bifrost/${id}`);
}

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

// Only bundled providers: OpenCode would otherwise install and run an arbitrary npm package.
const bundledPackage = /^@opencode\/ai\/providers\/[a-z0-9][a-z0-9/-]*$/;

// Model entries pass through to OpenCode unchanged, except for what could leak the key
// or run code: devn adds the key to every model with its own settings, so a model
// baseURL must stay on the approved OpenCode gateway origin.
export function validateOpenCode(value: unknown, baseUrl: string): asserts value is OpenCodeProfile {
  object(value, ['baseUrl', 'model', 'models']);
  // OpenCode expands these strings before validating config, even in model labels.
  requireValue(!/\{(?:env|file):/.test(JSON.stringify(value)), 'configuration substitutions are not allowed in remote profiles.');
  if (value.baseUrl !== undefined) {
    requireValue(typeof value.baseUrl === 'string' && !secureURL(value.baseUrl).search, 'baseUrl must be a URL without a query.');
  }
  if (value.models === undefined) {
    requireValue(value.model === undefined, 'model requires an explicit models list.');
    return;
  }
  object(value.models);
  requireValue(Object.keys(value.models).length > 0, 'models must not be empty.');
  const origin = secureURL(value.baseUrl ?? baseUrl).origin;
  for (const [id, model] of Object.entries(value.models)) {
    requireValue(identifier(id), 'invalid model ID.');
    object(model);
    requireValue(model.package === undefined || (typeof model.package === 'string' && bundledPackage.test(model.package)),
      'package must be a bundled @opencode/ai/providers/... provider.');
    if (model.settings !== undefined) {
      object(model.settings);
      requireValue(model.settings.baseURL === undefined || secureURL(model.settings.baseURL).origin === origin,
        'model settings.baseURL must use the OpenCode gateway origin.');
      requireValue(!['apiKey', 'authToken', 'auth'].some(key => key in model.settings), 'model settings must not contain credentials.');
    }
  }
  requireValue(identifier(value.model) && Object.hasOwn(value.models, value.model), 'model must appear in models.');
}
