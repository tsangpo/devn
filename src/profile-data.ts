import fs from 'node:fs';
import path from 'node:path';
import { clients } from './clients';
import { atomicWrite, privateFile, profileDir } from './files';

// Only scrub the credentials devn writes. Histories and personal settings stay intact.
export async function scrubCredentials(id: string): Promise<void> {
  const updates: { file: string; content: string }[] = [];
  for (const client of clients) {
    const tool = client.id;
    const file = path.join(profileDir(id), tool, client.config.filename);
    if (!await Bun.file(file).exists()) continue;
    privateFile(file);
    try {
      const text = await Bun.file(file).text();
      const config: any = client.config.parse(text);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
      client.config.scrub(config);
      updates.push({ file, content: client.config.serialize(config) });
    } catch { throw new Error(`Cannot safely remove credentials from ${tool} configuration. Repair it or use --purge.`); }
  }
  for (const update of updates) atomicWrite(update.file, update.content + '\n');
}

export function purgeProfileData(id: string): void {
  fs.rmSync(profileDir(id), { recursive: true, force: true });
}
