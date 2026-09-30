import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import type { Registration } from './registry';

function requireTTY(): void {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('This command requires an interactive terminal.');
}
export async function choose(profiles: Registration[]): Promise<Registration> {
  requireTTY();
  if (!profiles.length) throw new Error('No profiles are available. Run devn profile add.');
  profiles.forEach((p, i) => console.error(`  ${i + 1}. ${p.id} — ${p.name}`));
  const input = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await input.question('Profile (name or number): ')).trim();
    const profile = profiles.find(p => p.id === answer) || (/^[1-9][0-9]*$/.test(answer) ? profiles[Number(answer) - 1] : undefined);
    if (!profile) throw new Error('No matching profile selected.');
    return profile;
  } finally { input.close(); }
}

export async function password(): Promise<string> {
  requireTTY();
  process.stderr.write('Bifrost key (hidden): ');
  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(wasRaw || false);
      process.stdin.pause();
      process.stderr.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (text: string | undefined, key: readline.Key) => {
      if (key.ctrl && key.name === 'c') { process.exitCode = 130; finish(new Error('Cancelled.')); }
      else if (key.name === 'return' || key.name === 'enter') {
        if (!value.trim()) finish(new Error('Key cannot be empty.'));
        else finish();
      } else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (key.ctrl && key.name === 'u') value = '';
      else if (key.ctrl && key.name === 'd') finish(new Error('Cancelled.'));
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}

export async function question(prompt: string): Promise<string> {
  requireTTY();
  const input = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await input.question(prompt)).trim(); }
  finally { input.close(); }
}
