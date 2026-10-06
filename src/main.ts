import { loginCredentials, syncCredentials } from './oauth/lifecycle';
import type { AuthMode } from './oauth/authorize';
import { version } from '../package.json';
import example from '../profiles/example.json';
import oauthExample from '../profiles/oauth.example.json';
import { displayURL, secureURL } from './urls';
import { platform } from './platform';
import { loadConfig, getProfile, addProfile, refreshProfile, removeProfile, cachedProfile, safeId, bindProject, unbindProject } from './store';
import { validateProfile } from './profile';
import type { LocalConfig } from './types';
import { findBinding, requireProfile } from './projects';
import { choose, password, question } from './prompts';
import { launch } from './launch';
import { clients, isTool } from './clients';

const PROFILE_COMMANDS = `  devn profile list                 List locally registered profiles
  devn profile add [URL] [--auth auto|browser|device|manual]
  devn profile show [profile-name]   Show redacted local profile details
  devn profile remove <name> [--purge] Remove registration; --purge also deletes history
  devn profile use [profile-name]    Bind the current directory to a profile
  devn profile unbind               Remove the current directory's binding`;

const HELP = `Usage:
${PROFILE_COMMANDS}
  devn --version                    Print the CLI version
${clients.map(client => `  ${`devn ${client.id} [arguments...]`.padEnd(34)}${client.help}`).join('\n')}

${clients.flatMap(client => client.helpNotes ? [client.helpNotes] : []).join('\n\n')}

Keys and tool data stay local. Remote profiles refresh before launching a tool.
`;

function authArguments(args: string[], allowAuth: boolean, manual = false): { value?: string; mode: AuthMode | 'manual'; explicit: boolean } {
  let value: string | undefined, mode: AuthMode | 'manual' = 'auto', seen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--auth' || arg.startsWith('--auth=')) {
      if (!allowAuth || seen) throw new Error('Unexpected --auth option.');
      const input = arg === '--auth' ? args[++i] : arg.slice(7);
      if (!['auto', 'browser', 'device', ...(manual ? ['manual'] : [])].includes(input)) throw new Error('Invalid --auth mode.');
      mode = input as typeof mode; seen = true;
    } else if (arg.startsWith('-') || value !== undefined) throw new Error('Unexpected arguments. Run devn --help.');
    else value = arg;
  }
  return { value, mode, explicit: seen };
}

async function dispatch(config: LocalConfig, args: string[]): Promise<number> {
  if (isTool(args[0])) {
    const entry = requireProfile(config);
    const { profile } = await refreshProfile(entry.id);
    const key = await syncCredentials(entry.id);
    return launch(profile, args[0], args.slice(1), key);
  }
  if (args[0] !== 'profile') throw new Error('Unknown command. Run devn --help.');
  const [, action, id, ...extra] = args;
  const adding = action === 'add' ? authArguments(args.slice(2), true, true) : undefined;
  if (!adding && ((extra.length && !(action === 'remove' && extra.length === 1 && extra[0] === '--purge')) || (id !== undefined && !['use', 'show', 'remove'].includes(action)))) throw new Error('Unexpected arguments. Run devn --help.');
  if (action === 'list') {
    const binding = findBinding(config);
    for (const p of config.profiles) console.log(`${binding?.id === p.id ? '*' : ' '} ${p.id}`);
    if (!config.profiles.length) console.log('No profiles registered. Run devn profile add.');
    if (binding) console.log(`Binding: ${binding.dir} → ${binding.id}`);
    return 0;
  }
  if (action === 'add') {
    const url = adding!.value || await question('Profile JSON URL: ');
    const parsedURL = secureURL(url);
    let defaultName = '';
    try {
      const filename = decodeURIComponent(parsedURL.pathname.split('/').pop() || '');
      const candidate = /\.json$/i.test(filename) ? filename.slice(0, -5) : '';
      if (safeId(candidate)) defaultName = candidate;
    } catch { /* Invalid filename encoding leaves the name for the user to enter. */ }
    const name = await question(defaultName ? `Profile name [${defaultName}]: ` : 'Profile name: ') || defaultName;
    if (!safeId(name)) throw new Error('Invalid profile name. Use letters, numbers, hyphens, or underscores (up to 64 characters).');
    const existing = config.profiles.find(p => p.id === name);
    if (existing && !/^y(es)?$/i.test(await question(`Update profile ${name} URL and key? [y/N]: `))) {
      console.log('Cancelled.'); return 0;
    }
    const mode = adding!.mode;
    const manual = mode === 'manual' || (!!existing && !existing.auth && !adding!.explicit);
    await addProfile(name, url, async (profile, session) => {
      if (!manual && profile.auth) return loginCredentials(session!, mode as AuthMode);
      if (!manual && mode !== 'auto') throw new Error('Profile does not offer OAuth.');
      if (profile.authUrl) console.error(`Open this URL to get your Bifrost key: ${profile.authUrl}`);
      return password();
    }, existing, async profile => {
      console.error(`AI gateway: ${displayURL(profile.baseUrl)}`);
      return /^y(es)?$/i.test(await question('Trust these gateways to receive your key? [y/N]: '));
    });
    console.log(`Added ${name}. Run devn profile use ${name} in your project.`);
    return 0;
  }
  if (action === 'show') {
    const entry = id ? getProfile(config, id) : requireProfile(config);
    let cached = false;
    try { await cachedProfile(entry.id); cached = true; } catch { /* Show missing/invalid cache without parsing details. */ }
    console.log(JSON.stringify({
      profile: entry.id, url: displayURL(entry.url), key: '[redacted]',
      trustedOrigins: entry.origins || null, validCache: cached,
    }, null, 2));
    return 0;
  }
  if (action === 'remove') {
    if (!safeId(id)) throw new Error('Specify a valid profile name to remove.');
    const purge = extra[0] === '--purge';
    if (!purge) getProfile(config, id);
    console.error(purge ? 'This deletes all tool data and history. Stop active sessions first.' : 'This removes registration and generated credentials, preserving history. Stop active sessions first.');
    if (await question(`Type ${id} to confirm removal: `) !== id) { console.log('Cancelled.'); return 0; }
    await removeProfile(id, purge);
    console.log(`Removed ${id}${purge ? ' and all tool data' : '; tool history retained'}. Project bindings were not changed.`);
    return 0;
  }
  if (action === 'use') {
    const p = id ? getProfile(config, id) : await choose(config.profiles);
    const dir = platform.projectPath(process.cwd());
    await bindProject(dir, p.id);
    console.log(`Selected ${p.id} for ${dir}`);
    return 0;
  }
  if (action === 'unbind') {
    const dir = platform.projectPath(process.cwd());
    const binding = findBinding(config, dir);
    if (binding && binding.dir !== dir) throw new Error(`${dir} has no binding of its own; it inherits ${binding.dir}. Run devn profile unbind there.`);
    await unbindProject(dir);
    console.log(`Removed binding for ${dir}`);
    return 0;
  }
  throw new Error('Unknown profile command. Run devn --help.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) { console.log(version); return; }
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) { console.log(HELP); return; }
  if (args[0] === 'profile' && (args.length === 1 || (args.length === 2 && ['--help', '-h', 'help'].includes(args[1])))) {
    console.log(`Usage:\n${PROFILE_COMMANDS}`); return;
  }
  if (args[0] === '--validate-example') {
    validateProfile(example);
    validateProfile(oauthExample);
    console.log('Validated example profile.'); return;
  }
  process.exitCode = await dispatch(await loadConfig(), args);
}
main().catch(error => {
  console.error(`devn: ${error.message}`);
  process.exitCode ||= 1;
});
