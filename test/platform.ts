import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { windowsTests } from './windows/fixtures';

const posixTests = {
  posix: true,
  enter: '\n',
  operationTimeout: 2000,
  timeout: 20000,
  entry: (file: string) => [file],
  executableName: (name: string) => name,
  writeExecutable(file: string, source: string) { fs.writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o755 }); },
  assertPrivate(file: string, mode: number) { assert.equal(fs.statSync(file).mode & 0o777, mode); },
  linkDirectory(target: string, link: string) { fs.symlinkSync(target, link); },
  environment: () => ({ ...process.env }),
};
export const testPlatform: typeof posixTests = process.platform === 'win32' ? windowsTests : posixTests;
export function prependPath(dir: string, env = testPlatform.environment()) {
  return { ...env, PATH: dir + path.delimiter + (env.PATH || '') };
}

export async function writeStandalone(file: string, source: string) {
  const script = file + '.ts';
  fs.writeFileSync(script, source);
  try {
    const result = await Bun.build({ entrypoints: [script], compile: {
      outfile: testPlatform.executableName(file), autoloadDotenv: false, autoloadBunfig: false,
      autoloadTsconfig: false, autoloadPackageJson: false,
    } });
    assert.equal(result.success, true, String(result.logs));
  } finally { fs.unlinkSync(script); }
}
