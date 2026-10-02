import { clients, getClient } from './clients';
import { profileDir } from './files';
import { generateConfig } from './config';
import { endpoint } from './registry';
import type { Profile, Tool } from './types';
import { runAttached } from './process';

export async function launch(profile: Profile, tool: Tool, args: string[], apiKey: string): Promise<number> {
  if (profile.example) throw new Error('The example profile cannot connect. Run devn profile add with a real profile first.');
  const client = getClient(tool);
  const prepared = client.checkArgs(args, profile);
  const generated = await generateConfig(profile, tool, apiKey);
  const env = { ...process.env };
  for (const entry of clients) entry.clearEnvironment?.(env);
  const result = client.prepareLaunch({ profile, root: profileDir(profile.id), generated, prepared, env });
  console.error(`devn: ${profile.id} → ${tool} (${endpoint(profile, tool)})`);
  if (result.kind === 'output') {
    console.log(result.text);
    return 0;
  }
  return runAttached(result.command, result.args, result.env);
}
