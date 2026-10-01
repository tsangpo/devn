import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

// Keep Windows removable without editing the application's business modules.
test('business modules use the platform facade and contain no Windows-specific branches', () => {
  const root = path.join(import.meta.dir, '..', 'src');
  for (const name of fs.readdirSync(root).filter(name => name.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    expect(source, name).not.toMatch(/platform\/(?:windows|posix)|\bwin32\b|\bLOCALAPPDATA\b|\bSystemRoot\b|powershell/i);
  }
});
