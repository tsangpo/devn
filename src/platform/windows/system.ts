import path from 'node:path';
import type { Environment } from '../types';

export function environmentValue(env: Environment, name: string): string | undefined {
  return Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

export function powershellCommand(script: string): string[] {
  const root = environmentValue(process.env, 'SystemRoot');
  if (!root || !path.win32.isAbsolute(root)) throw new Error('Windows SystemRoot is unavailable.');
  const executable = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const source = "$ErrorActionPreference = 'Stop'; [Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);\n" + script;
  return [executable, '-NoLogo', '-NoProfile', '-NonInteractive',
    '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')];
}

export function powershell(script: string, data: unknown): string {
  const result = Bun.spawnSync(powershellCommand(script), {
    stdin: Buffer.from(JSON.stringify(data)), stdout: 'pipe', stderr: 'pipe', windowsHide: true,
  });
  // Do not expose path, script diagnostics, or environment values in failures.
  if (result.exitCode !== 0) throw new Error('Windows system operation failed; check filesystem permissions and PowerShell availability.', { cause: result.stderr.toString() });
  return result.stdout.toString().trim();
}
