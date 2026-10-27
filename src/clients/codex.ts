import path from 'node:path';

import type { Profile } from '../types';
import { validateCodex } from './codex-profile';
import { clearEnvironment, codexClaudeEnvironment } from './environment';
import { codexTelemetry, codexTelemetryArgs } from './telemetry';
import type { Client, PreparedArgs } from './types';

export const codexCommand = { name: 'codex', npmPackage: '@openai/codex' };
const models = (profile: Profile) => ({
  ids: profile.codex.models?.map((m) => m.slug),
  defaultModel: profile.codex.model,
});

// Root options that consume a value (Codex 0.162). -i/--image takes several files.
const rootValueFlags = new Set([
  '-c',
  '--config',
  '--enable',
  '--disable',
  '--remote',
  '--remote-auth-token-env',
  '-m',
  '--model',
  '--local-provider',
  '-p',
  '--profile',
  '-s',
  '--sandbox',
  '-C',
  '--cd',
  '--add-dir',
  '-a',
  '--ask-for-approval',
]);
// resume and fork start the TUI too; any other first positional is a prompt for the TUI.
const batchCommands = new Set([
  'agents',
  'exec',
  'e',
  'review',
  'login',
  'logout',
  'mcp',
  'plugin',
  'app-server',
  'remote-control',
  'completion',
  'update',
  'doctor',
  'sandbox',
  'debug',
  'apply',
  'a',
  'queue',
  'archive',
  'delete',
  'migrate-rollouts',
  'unarchive',
  'cloud',
  'exec-server',
  'features',
  'help',
]);

function startsTui(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return true;
    if (arg === '-i' || arg === '--image') {
      while (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
    } else if (rootValueFlags.has(arg)) i++;
    else if (!arg.startsWith('-')) return !batchCommands.has(arg);
  }
  return true;
}

function checkArgs(args: string[], profile: Profile): PreparedArgs {
  let hasModel = false;
  const forbidden = new Set([
    '--profile',
    '-p',
    '--cd',
    '-C',
    '--remote',
    '--oss',
    '--local-provider',
  ]);
  const ids = models(profile).ids;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    const flag = arg.split('=')[0];
    if (forbidden.has(flag) || (/^-(?:p|C).+/.test(arg) && !arg.startsWith('--'))) {
      throw new Error(
        `${flag} conflicts with the project profile. Use devn profile use to change profiles.`,
      );
    }
    if (flag === '--model' || flag === '-m' || /^-m.+/.test(arg)) {
      const value = arg.includes('=')
        ? arg.slice(arg.indexOf('=') + 1)
        : arg.startsWith('-m') && arg.length > 2
          ? arg.slice(2)
          : args[++i];
      if (!value || (ids && !ids.includes(value)))
        throw new Error(`Model must be one of the codex models in profile ${profile.id}.`);
      hasModel = true;
    }
    if (flag === '--enable') {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
      if (value === 'daemon_auto_start')
        throw new Error('daemon_auto_start is disabled for project profiles.');
    }
    if (flag === '--config' || flag === '-c' || /^-c[^-].+/.test(arg)) {
      const value = arg.startsWith('--config=')
        ? arg.slice(9)
        : arg.startsWith('-c') && arg.length > 2
          ? arg.slice(2)
          : args[++i];
      const key = value?.split('=')[0].trim().replaceAll('"', '').replaceAll("'", '');
      let configRoot = key?.split('.')[0].trim();
      // Decode TOML quoted/escaped keys and whitespace around dotted keys.
      try {
        configRoot = Object.keys(Bun.TOML.parse(`${value?.split('=')[0]}=false`))[0];
      } catch {}
      if (
        profile.telemetry === false &&
        ['analytics', 'feedback', 'otel'].includes(configRoot ?? '')
      ) {
        throw new Error('Telemetry config overrides conflict with the project profile.');
      }
      if (
        !key ||
        /^(features(?:\.daemon_auto_start)?$|model$|model_provider$|model_providers(?:\.|$)|model_catalog_json$|models(?:\.|$)|profiles?(?:\.|$)|openai_base_url$|chatgpt_base_url$|forced_login_method$|forced_chatgpt_workspace_id$)/.test(
          key,
        )
      ) {
        throw new Error(
          'Connection/model config overrides conflict with the project profile. Use --model for a listed model.',
        );
      }
    }
  }
  return { args, hasModel, interactive: startsTui(args) };
}

export const codex: Client = {
  id: 'codex',
  required: true,
  label: 'Codex',
  help: 'Refresh profile, update config, and start Codex',
  gatewayPath: 'openai/v1',
  validateProfile: validateCodex,
  models,
  checkArgs,
  config: {
    filename: 'config.toml',
    parse: Bun.TOML.parse,
    serialize: (data) => Bun.TOML.stringify(data)!,
    replacePaths: ['model_providers.bifrost'],
    build({ profile, dir, endpoint, apiKey, existing, model }) {
      const catalog = path.join(dir, 'models.json');
      return {
        managed: {
          ...(profile.telemetry === false ? codexTelemetry : {}),
          ...(model ? { model } : {}),
          model_provider: 'bifrost',
          // Gateway model support does not imply hosted OpenAI search support.
          web_search: existing.web_search ?? 'disabled',
          // The shared background daemon outlives the session and is not bound to this profile.
          features: { daemon_auto_start: false },
          ...(profile.codex.models ? { model_catalog_json: catalog } : {}),
          model_providers: {
            bifrost: {
              name: 'Bifrost',
              base_url: endpoint,
              wire_api: 'responses',
              experimental_bearer_token: apiKey,
              requires_openai_auth: false,
              supports_websockets: false,
            },
          },
        },
        files: profile.codex.models
          ? [{ name: 'models.json', data: { models: profile.codex.models } }]
          : [],
      };
    },
    scrub(config) {
      delete config.model_providers?.bifrost?.experimental_bearer_token;
    },
  },
  clearEnvironment(env) {
    clearEnvironment(env, [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'CODEX_API_KEY',
      'CODEX_MODEL',
      'CODEX_PROFILE',
      'CODEX_HOME',
    ]);
  },
  prepareLaunch({ profile, root, generated, prepared, env }) {
    const options = [
      '-c',
      'model_provider="bifrost"',
      // CLI precedence also beats trusted project config. User overrides are checked above.
      ...(profile.telemetry === false ? codexTelemetryArgs : []),
      ...(profile.codex.models
        ? ['-c', `model_catalog_json=${JSON.stringify(path.join(root, 'codex', 'models.json'))}`]
        : []),
      ...(prepared.hasModel || !generated.model ? [] : ['--model', generated.model]),
      // Root option: also keeps the TUI off a shared daemon that is already running.
      ...(prepared.interactive && !prepared.args.includes('--no-daemon') ? ['--no-daemon'] : []),
    ];
    return {
      kind: 'process',
      command: codexCommand,
      args: [...options, ...prepared.args],
      env: codexClaudeEnvironment(root, env),
    };
  },
};
