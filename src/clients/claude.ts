import type { Profile } from '../types';
import { jsonConfig, type Client, type PreparedArgs } from './types';
import { validateClaude } from './claude-profile';
import { clearEnvironment, codexClaudeEnvironment } from './environment';

export const claudeCommand = { name: 'claude', npmPackage: '@anthropic-ai/claude-code' };
const models = (profile: Profile) => ({ ids: profile.claude.modelPicker?.options.map(m => m.model), defaultModel: profile.claude.model });

function checkArgs(args: string[], profile: Profile): PreparedArgs {
  const ids = models(profile).ids;
  const allowed = new Set([...(ids || []), 'sonnet', 'opus', 'haiku']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    const flag = arg.split('=')[0];
    if (['--settings', '--setting-sources', '--bare'].includes(flag)) {
      throw new Error(`${flag} conflicts with the project profile. Use devn profile use to change profiles.`);
    }
    if (flag === '--model') {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
      if (!value || (ids && !allowed.has(value))) throw new Error(`Model must be one of the claude models in profile ${profile.id}.`);
    }
  }
  return { args };
}

export const claude: Client = {
  id: 'claude', required: true, label: 'Claude',
  help: 'Refresh profile, update config, and start Claude Code', gatewayPath: 'anthropic',
  validateProfile: validateClaude, models, checkArgs,
  config: {
    ...jsonConfig, filename: 'settings.json', replacePaths: ['modelPicker'],
    build({ profile, endpoint, apiKey, model }) {
      return { managed: {
        ...(model ? { model } : {}),
        env: {
          ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: apiKey,
          ANTHROPIC_API_KEY: '', CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_FOUNDRY: '0',
          ...(profile.claude.modelPicker ? {
            ANTHROPIC_DEFAULT_SONNET_MODEL: profile.claude.slots?.sonnet || profile.claude.model,
            ANTHROPIC_DEFAULT_OPUS_MODEL: profile.claude.slots?.opus || profile.claude.model,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.claude.slots?.haiku || profile.claude.model,
          } : {}),
        },
        ...(profile.claude.modelPicker ? { modelPicker: profile.claude.modelPicker } : {}),
      } };
    },
    scrub(config) {
      delete config.env?.ANTHROPIC_AUTH_TOKEN;
      delete config.env?.ANTHROPIC_API_KEY;
    },
  },
  clearEnvironment(env) {
    clearEnvironment(env, ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'], ['ANTHROPIC_', 'CLAUDE_CODE_USE_']);
  },
  prepareLaunch({ root, generated, prepared, env }) {
    return { kind: 'process', command: claudeCommand, args: ['--settings', generated.file, ...prepared.args], env: codexClaudeEnvironment(root, env) };
  },
};
