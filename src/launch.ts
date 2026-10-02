import path from 'node:path';
import { openCodeArgs, openCodeCommand, openCodeEnvironment } from './opencode';
import { profileDir } from './files';
import { generateConfig } from './config';
import { endpoint, modelIds, type Profile, type Tool } from './registry';
import { runAttached } from './process';

function checkArgs(args: string[], profile: Profile, tool: Tool): { hasModel: boolean } {
  let hasModel = false;
  const forbidden = new Set(tool === 'codex'
    ? ['--profile', '-p', '--cd', '-C', '--remote', '--oss', '--local-provider']
    : ['--settings', '--setting-sources', '--bare']);
  const ids = modelIds(profile, tool);
  const models = new Set(ids);
  if (tool === 'claude') for (const alias of ['sonnet', 'opus', 'haiku']) models.add(alias);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    const flag = arg.split('=')[0];
    if (forbidden.has(flag) || (tool === 'codex' && /^-(?:p|C).+/.test(arg) && !arg.startsWith('--'))) {
      throw new Error(`${flag} conflicts with the project profile. Use devn profile use to change profiles.`);
    }
    if (flag === '--model' || (tool === 'codex' && (flag === '-m' || /^-m.+/.test(arg)))) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : (arg.startsWith('-m') && arg.length > 2 ? arg.slice(2) : args[++i]);
      if (!value || (ids && !models.has(value))) throw new Error(`Model must be one of the ${tool} models in profile ${profile.id}.`);
      hasModel = true;
    }
    if (tool === 'codex' && (flag === '--config' || flag === '-c' || /^-c[^-].+/.test(arg))) {
      const value = arg.startsWith('--config=') ? arg.slice(9) : (arg.startsWith('-c') && arg.length > 2 ? arg.slice(2) : args[++i]);
      const key = value?.split('=')[0].trim().replaceAll('"', '').replaceAll("'", '');
      if (!key || /^(model$|model_provider$|model_providers(?:\.|$)|model_catalog_json$|models(?:\.|$)|profiles?(?:\.|$)|openai_base_url$|chatgpt_base_url$|forced_login_method$|forced_chatgpt_workspace_id$)/.test(key)) {
        throw new Error('Connection/model config overrides conflict with the project profile. Use --model for a listed model.');
      }
    }
  }
  return { hasModel };
}

export async function launch(profile: Profile, tool: Tool, args: string[], apiKey: string): Promise<number> {
  if (profile.example) throw new Error('The example profile cannot connect. Run devn profile add with a real profile first.');
  const openCode = tool === 'opencode' ? openCodeArgs(args, profile) : undefined;
  const { hasModel } = openCode ? { hasModel: false } : checkArgs(args, profile, tool);
  const generated = await generateConfig(profile, tool, apiKey);
  const root = profileDir(profile.id);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const name = key.toUpperCase();
    if (name.startsWith('ANTHROPIC_') || name.startsWith('CLAUDE_CODE_USE_') ||
      ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'CODEX_MODEL', 'CODEX_PROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'].includes(name)) delete env[key];
  }
  if (openCode) {
    const isolated = openCodeEnvironment(root, env);
    if (openCode.model) isolated.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: openCode.model });
    const command = openCodeCommand(isolated);
    console.error(`devn: ${profile.id} → opencode (${endpoint(profile, tool)})`);
    // v2's models command can return an empty snapshot before its private server
    // finishes loading plugins. The approved manifest is our catalog authority.
    if (openCode.args[0] === 'models' && openCode.args.slice(1).every(arg => ['--standalone', '--print-logs'].includes(arg))) {
      console.log(modelIds(profile, tool)!.sort((a, b) => a.localeCompare(b)).join('\n'));
      return 0;
    }
    return runAttached(command, openCode.args, isolated);
  }
  env.CODEX_HOME = path.join(root, 'codex');
  env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '0';
  const options = tool === 'codex'
    ? ['-c', 'model_provider="bifrost"',
      ...(profile.codex.models ? ['-c', `model_catalog_json=${JSON.stringify(path.join(root, 'codex', 'models.json'))}`] : []),
      ...(hasModel || !generated.model ? [] : ['--model', generated.model])]
    : ['--settings', generated.file];
  console.error(`devn: ${profile.id} → ${tool} (${endpoint(profile, tool)})`);
  return runAttached(tool, [...options, ...args], env);
}
