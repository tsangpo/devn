import { $ } from 'bun';
import { expect, test } from 'bun:test';
import { archiveName, type Platform, verifyArchive, version } from '../../scripts/release-lib';

const root = Bun.fileURLToPath(new URL('../../', import.meta.url));
const platform = (process.platform + '-' + process.arch) as Platform;

test('release archive runs outside the source tree with no Bun on PATH', async () => {
  const archive = root + '/release/' + archiveName(platform);
  await verifyArchive(archive);
  const contents = (await $`tar -tzf ${archive}`.text()).trim().split('\n').sort();
  expect(contents).toEqual(['LICENSE', 'devn']);
  const created = (await $`mktemp -d`.text()).trim();
  const temp = (await $`/bin/pwd -P`.cwd(created).text()).trim();
  try {
    const bin = temp + '/bin';
    const project = temp + '/project with spaces';
    const home = temp + '/config';
    await $`mkdir -p ${bin} ${project}`.quiet();
    await $`tar -xzf ${archive} -C ${bin}`.quiet();
    // Caller-owned files must not be parsed or executed by the embedded runtime.
    await Bun.write(project + '/.env', 'DEVN_DOTENV_TEST=unexpected\n');
    await Bun.write(project + '/bunfig.toml', 'invalid = [');
    await Bun.write(project + '/tsconfig.json', '{invalid');
    await Bun.write(project + '/package.json', '{invalid');
    const env = { HOME: temp, PATH: bin, XDG_CONFIG_HOME: home };
    function run(args: string[]) {
      return Bun.spawnSync([bin + '/devn', ...args], { cwd: project, env, stdout: 'pipe', stderr: 'pipe' });
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
        origins: { codex: 'http://127.0.0.1:1', claude: 'http://127.0.0.1:1' } } },
    }));
    await Bun.write(home + '/devn/profiles/smoke/profile.json', JSON.stringify({
      version: 1, id: 'smoke', baseUrl: 'http://127.0.0.1:1', codex: {}, claude: {},
    }));
    expect(run(['profile', 'use', 'smoke']).exitCode).toBe(0);
    expect(await Bun.file(project + '/.devn.json').json()).toEqual({ version: 1, profile: 'smoke' });
    for (const tool of ['codex', 'claude']) {
      await Bun.write(bin + '/' + tool, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$CODEX_HOME" "$CLAUDE_CONFIG_DIR" "$DEVN_DOTENV_TEST" "$@"\nexit 7\n');
      await $`chmod +x ${bin + '/' + tool}`.quiet();
      const result = run([tool, 'prompt with spaces and $literal']);
      expect(result.exitCode).toBe(7);
      const lines = result.stdout.toString().trim().split('\n');
      expect(lines[0]).toBe(project);
      expect(lines[tool === 'codex' ? 1 : 2]).toBe(home + '/devn/profiles/smoke/' + tool);
      expect(lines[3]).toBe('');
      expect(lines.at(-1)).toBe('prompt with spaces and $literal');
    }
    const codex = Bun.TOML.parse(await Bun.file(home + '/devn/profiles/smoke/codex/config.toml').text()) as any;
    expect(codex.model_providers.bifrost.experimental_bearer_token).toBe('standalone-dummy-key');
    const claude = await Bun.file(home + '/devn/profiles/smoke/claude/settings.json').json();
    expect(claude.env.ANTHROPIC_AUTH_TOKEN).toBe('standalone-dummy-key');
  } finally {
    await $`rm -rf ${temp}`.quiet();
  }
}, 30000);
