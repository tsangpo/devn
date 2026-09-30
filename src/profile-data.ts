import fs from 'node:fs';
import { atomicWrite, profileDir } from './files';

// Only scrub the credentials devn writes. Histories and personal settings stay intact.
export async function scrubCredentials(id: string): Promise<void> {
  const updates: { file: string; content: string }[] = [];
  for (const tool of ['codex', 'claude']) {
    const file = `${profileDir(id)}/${tool}/${tool === 'codex' ? 'config.toml' : 'settings.json'}`;
    if (!await Bun.file(file).exists()) continue;
    try {
      const text = await Bun.file(file).text();
      const config: any = tool === 'codex' ? Bun.TOML.parse(text) : JSON.parse(text);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
      if (tool === 'codex') delete config.model_providers?.bifrost?.experimental_bearer_token;
      else {
        delete config.env?.ANTHROPIC_AUTH_TOKEN;
        delete config.env?.ANTHROPIC_API_KEY;
      }
      updates.push({ file, content: tool === 'codex' ? Bun.TOML.stringify(config) : JSON.stringify(config, null, 2) });
    } catch { throw new Error(`Cannot safely remove credentials from ${tool} configuration. Repair it or use --purge.`); }
  }
  for (const update of updates) atomicWrite(update.file, update.content + '\n');
}

export function purgeProfileData(id: string): void {
  fs.rmSync(profileDir(id), { recursive: true, force: true });
}
