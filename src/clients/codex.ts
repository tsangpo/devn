import path from 'node:path';
import type { Profile } from '../types';
import type { Client, PreparedArgs } from './types';
import { validateCodex } from './codex-profile';
import { clearEnvironment, codexClaudeEnvironment } from './environment';

export const codexCommand = { name: 'codex', npmPackage: '@openai/codex' };
const models = (profile: Profile) => ({ ids: profile.codex.models?.map(m => m.slug), defaultModel: profile.codex.model });

function checkArgs(args: string[], profile: Profile): PreparedArgs {
  let hasModel = false;
  const forbidden = new Set(['--profile', '-p', '--cd', '-C', '--remote', '--oss', '--local-provider']);
  const ids = models(profile).ids;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    const flag = arg.split('=')[0];
    if (forbidden.has(flag) || (/^-(?:p|C).+/.test(arg) && !arg.startsWith('--'))) {
      throw new Error(`${flag} conflicts with the project profile. Use devn profile use to change profiles.`);
    }
    if (flag === '--model' || flag === '-m' || /^-m.+/.test(arg)) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : (arg.startsWith('-m') && arg.length > 2 ? arg.slice(2) : args[++i]);
      if (!value || (ids && !ids.includes(value))) throw new Error(`Model must be one of the codex models in profile ${profile.id}.`);
      hasModel = true;
    }
    if (flag === '--config' || flag === '-c' || /^-c[^-].+/.test(arg)) {
      const value = arg.startsWith('--config=') ? arg.slice(9) : (arg.startsWith('-c') && arg.length > 2 ? arg.slice(2) : args[++i]);
      const key = value?.split('=')[0].trim().replaceAll('"', '').replaceAll("'", '');
      if (!key || /^(model$|model_provider$|model_providers(?:\.|$)|model_catalog_json$|models(?:\.|$)|profiles?(?:\.|$)|openai_base_url$|chatgpt_base_url$|forced_login_method$|forced_chatgpt_workspace_id$)/.test(key)) {
        throw new Error('Connection/model config overrides conflict with the project profile. Use --model for a listed model.');
      }
    }
  }
  return { args, hasModel };
}

export const codex: Client = {
  id: 'codex', required: true, label: 'Codex',
  help: 'Refresh profile, update config, and start Codex', gatewayPath: 'openai/v1',
  validateProfile: validateCodex, models, checkArgs,
  config: {
    filename: 'config.toml', parse: Bun.TOML.parse, serialize: data => Bun.TOML.stringify(data)!,
    replacePaths: ['model_providers.bifrost'],
    build({ profile, dir, endpoint, apiKey, existing, model }) {
      const catalog = path.join(dir, 'models.json');
      return {
        managed: {
          ...(model ? { model } : {}), model_provider: 'bifrost',
          // Gateway model support does not imply hosted OpenAI search support.
          web_search: existing.web_search ?? 'disabled',
          ...(profile.codex.models ? { model_catalog_json: catalog } : {}),
          model_providers: { bifrost: {
            name: 'Bifrost', base_url: endpoint, wire_api: 'responses',
            experimental_bearer_token: apiKey, requires_openai_auth: false, supports_websockets: false,
          } },
        },
        files: profile.codex.models ? [{ name: 'models.json', data: { models: profile.codex.models } }] : [],
      };
    },
    scrub(config) { delete config.model_providers?.bifrost?.experimental_bearer_token; },
  },
  clearEnvironment(env) {
    clearEnvironment(env, ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'CODEX_MODEL', 'CODEX_PROFILE', 'CODEX_HOME']);
  },
  prepareLaunch({ profile, root, generated, prepared, env }) {
    const options = ['-c', 'model_provider="bifrost"',
      ...(profile.codex.models ? ['-c', `model_catalog_json=${JSON.stringify(path.join(root, 'codex', 'models.json'))}`] : []),
      ...(prepared.hasModel || !generated.model ? [] : ['--model', generated.model])];
    return { kind: 'process', command: codexCommand, args: [...options, ...prepared.args], env: codexClaudeEnvironment(root, env) };
  },
};
