import fs from 'node:fs';
import path from 'node:path';
import { jsonConfig, type Client } from './types';
import { openCodeModels, validateOpenCode } from './opencode-profile';
import { openCodeArgs, openCodeCommand, openCodeEnvironment } from './opencode-runtime';

export const opencode: Client = {
  id: 'opencode', required: false, label: 'OpenCode',
  help: 'Refresh profile and start OpenCode v2', gatewayPath: 'openai/v1',
  helpNotes: `OpenCode uses a private server and profile-only configuration. External servers,
directory overrides, service/pair/serve, auth/api and installation management are unsupported.
Supported: run, mini, models, session, stats, debug, acp, mcp, plugin, reload.`,
  validateProfile(value, baseUrl) {
    validateOpenCode(value);
    if (/\{(?:env|file):/.test(baseUrl)) throw new Error('OpenCode gateway URLs must not contain configuration substitutions.');
  },
  models(profile) {
    if (!profile.opencode) throw new Error('Add an opencode section with model and models to the remote profile first.');
    return { ids: openCodeModels(profile.opencode), defaultModel: `bifrost/${profile.opencode.model}` };
  },
  config: {
    ...jsonConfig, filename: 'opencode.json', replacePaths: ['providers.bifrost'],
    checkFiles(dir) {
      if (fs.existsSync(path.join(dir, 'opencode.jsonc'))) {
        throw new Error('Use the profile opencode.json for local settings; opencode.jsonc would override managed configuration.');
      }
    },
    build({ profile, endpoint, apiKey, existing, model }) {
      if (existing.plugins !== undefined && !Array.isArray(existing.plugins)) throw new Error('Invalid OpenCode plugins.');
      const policies = existing.experimental?.policies;
      if (policies !== undefined && !Array.isArray(policies)) throw new Error('Invalid OpenCode policies.');
      return {
        managed: {
          ...(model ? { model } : {}),
          providers: { bifrost: {
            name: 'Bifrost', package: '@opencode/ai/providers/openai-compatible',
            env: [], settings: { baseURL: endpoint, apiKey }, models: profile.opencode!.models,
          } },
          plugins: [...(existing.plugins || []).filter((p: unknown) => p !== '-opencode.config.compatibility'), '-opencode.config.compatibility'],
          experimental: { policies: [
            ...(policies || []).filter((p: any) => p?.action !== 'provider.use'),
            { action: 'provider.use', resource: '*', effect: 'deny' },
            { action: 'provider.use', resource: 'bifrost', effect: 'allow' },
          ] },
        },
        files: [
          { name: 'service.json', data: { disabled: true } },
          { name: 'cli.json', ifMissing: true, data: { $schema: 'https://opencode.ai/v2/cli.json', theme: { name: 'system' } } },
        ],
      };
    },
    scrub(config) { delete config.providers?.bifrost?.settings?.apiKey; },
  },
  checkArgs: openCodeArgs,
  prepareLaunch({ profile, root, prepared, env }) {
    const isolated = openCodeEnvironment(root, env);
    if (prepared.model) isolated.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: prepared.model });
    const command = openCodeCommand(isolated);
    // The private server may return an empty catalog before plugins finish loading.
    // Preserve version probing even when displaying the approved manifest locally.
    if (prepared.args[0] === 'models' && prepared.args.slice(1).every(arg => ['--standalone', '--print-logs'].includes(arg))) {
      return { kind: 'output', text: openCodeModels(profile.opencode)!.sort((a, b) => a.localeCompare(b)).join('\n') };
    }
    return { kind: 'process', command, args: prepared.args, env: isolated };
  },
};
