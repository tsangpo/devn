import { clients, getClient } from './clients';
import { profileDir } from './files';
import { prepareConfig } from './store';
import type { Profile, Tool } from './types';
import { platform } from './platform';

export async function launch(profile: Profile, tool: Tool, args: string[], apiKey: string): Promise<number> {
  if (profile.example) throw new Error('The example profile cannot connect. Run devn profile add with a real profile first.');
  const client = getClient(tool);
  const prepared = client.checkArgs(args, profile);
  const generated = await prepareConfig(profile, tool, apiKey);
  const env = { ...process.env };
  for (const entry of clients) entry.clearEnvironment?.(env);
  const result = client.prepareLaunch({ profile, root: profileDir(profile.id), generated, prepared, env });
  if (result.kind === 'output') {
    console.log(result.text);
    return 0;
  }
  return platform.runAttached(result.command, result.args, result.env);
}
