import { realpathSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { targets, hostPlatform } from '../../scripts/platform';
import { testPlatform, writeStandalone } from '../platform';
import { expect, test } from 'bun:test';
import { archiveName, verifyArchive, version } from '../../scripts/release-lib';

const root = Bun.fileURLToPath(new URL('../../', import.meta.url));
const platform = hostPlatform();
const target = targets[platform];

test('release archive runs outside the source tree with no Bun on PATH', async () => {
  const archive = root + '/release/' + archiveName(platform);
  await verifyArchive(archive);
  const contents = (await target.archive.entries(archive)).sort();
  expect(contents).toEqual(['LICENSE', target.executable]);
  const temp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'devn-binary-')));
  try {
    const bin = path.join(temp, 'bin');
    const project = path.join(temp, 'project with spaces');
    const home = path.join(temp, 'config');
    mkdirSync(bin); mkdirSync(project);
    await target.archive.extract(archive, bin);
    // Caller-owned files must not be parsed or executed by the embedded runtime.
    await Bun.write(project + '/.env', 'DEVN_DOTENV_TEST=unexpected\n');
    await Bun.write(project + '/bunfig.toml', 'invalid = [');
    await Bun.write(project + '/tsconfig.json', '{invalid');
    await Bun.write(project + '/package.json', '{invalid');
    const env = { ...testPlatform.environment(), HOME: temp, PATH: bin, XDG_CONFIG_HOME: home };
    function run(args: string[]) {
      return Bun.spawnSync([path.join(bin, target.executable), ...args], { cwd: project, env, stdout: 'pipe', stderr: 'pipe' });
    }
    for (const [args, expected] of [
      [['--version'], version], [['--help'], 'devn profile add'],
      [['--validate-example'], 'Validated example profile'],
      [['profile', 'list'], 'No profiles registered'],
    ] as [string[], string][]) {
      const result = run(args);
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(expected);
    }
    await Bun.write(home + '/devn/config.toml', Bun.TOML.stringify({
      version: 1, profiles: { smoke: { url: 'http://127.0.0.1:1/profile.json', key: 'standalone-dummy-key',
        origins: { codex: 'http://127.0.0.1:1', claude: 'http://127.0.0.1:1', opencode: 'http://127.0.0.1:1' } } },
    }));
    await Bun.write(home + '/devn/profiles/smoke/profile.json', JSON.stringify({
      version: 1, id: 'smoke', baseUrl: 'http://127.0.0.1:1', codex: {}, claude: {}, opencode: { model: 'coding', models: { coding: {} } },
    }));
    expect(run(['profile', 'use', 'smoke']).exitCode).toBe(0);
    expect(Bun.TOML.parse(await Bun.file(home + '/devn/config.toml').text()).projects[realpathSync.native(project)]).toBe('smoke');
    for (const tool of ['codex', 'claude']) {
      await writeStandalone(path.join(bin, tool), `
console.log(process.cwd());
console.log(process.env.CODEX_HOME || '');
console.log(process.env.CLAUDE_CONFIG_DIR || '');
console.log(process.env.DEVN_DOTENV_TEST || '');
for (const arg of process.argv.slice(2)) console.log(arg);
process.exit(7);
`);
      const result = run([tool, 'prompt with spaces and $literal']);
      expect(result.exitCode).toBe(7);
      const lines = result.stdout.toString().trim().split(/\r?\n/);
      expect(lines[0]).toBe(project);
      expect(lines[tool === 'codex' ? 1 : 2]).toBe(path.join(home, 'devn/profiles/smoke', tool));
      expect(lines[3]).toBe('');
      expect(lines.at(-1)).toBe('prompt with spaces and $literal');
    }
    await writeStandalone(path.join(bin, 'opencode'), `
if (process.argv[2] === '--version') { console.log('2.0.21'); process.exit(0); }
console.log(process.env.OPENCODE_CONFIG_DIR);
console.log(JSON.stringify(process.argv.slice(2)));
process.exit(7);
`);
    const openCode = run(['opencode', 'run', 'prompt with spaces and $literal']);
    expect(openCode.exitCode).toBe(7);
    const openCodeLines = openCode.stdout.toString().trim().split(/\r?\n/);
    expect(openCodeLines[0]).toBe(path.join(home, 'devn/profiles/smoke/opencode'));
    expect(JSON.parse(openCodeLines[1])).toEqual(['run', '--standalone', 'prompt with spaces and $literal']);
    const openCodeConfig = await Bun.file(home + '/devn/profiles/smoke/opencode/opencode.json').json();
    expect(openCodeConfig.providers.bifrost.settings.apiKey).toBe('standalone-dummy-key');
    const codex = Bun.TOML.parse(await Bun.file(home + '/devn/profiles/smoke/codex/config.toml').text()) as any;
    expect(codex.model_providers.bifrost.experimental_bearer_token).toBe('standalone-dummy-key');
    const claude = await Bun.file(home + '/devn/profiles/smoke/claude/settings.json').json();
    expect(claude.env.ANTHROPIC_AUTH_TOKEN).toBe('standalone-dummy-key');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, testPlatform.timeout);
