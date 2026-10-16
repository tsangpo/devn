import { version } from '../package.json';

export { version };
export const repository = 'tsangpo/devn';
// Every channel ships the same Bun source package; Homebrew compiles it during install.
export const assetNames = () => ['devn.tgz'];
// Must match the ICU that Homebrew's bun links on Linux; the Formula refuses to build otherwise.
export const homebrewIcu = 'icu4c@78';

export function releaseTag(tag = process.env.RELEASE_TAG): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || tag !== 'v' + version) {
    throw new Error('Release tag must match the stable package.json version: v' + version);
  }
  return tag;
}

export function shouldPromoteRelease(latest: string, next = 'v' + version): boolean {
  const parse = (tag: string) => {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
      throw new Error('Cannot compare stable release tag: ' + tag);
    }
    return tag.slice(1).split('.').map(BigInt);
  };
  const oldParts = parse(latest);
  const newParts = parse(next);
  for (let i = 0; i < 3; i++) {
    if (newParts[i] !== oldParts[i]) return newParts[i] > oldParts[i];
  }
  return true;
}

export async function digest(file: string, algorithm: 'sha256' | 'sha512' = 'sha256'): Promise<string> {
  return new Bun.CryptoHasher(algorithm).update(await Bun.file(file).arrayBuffer()).digest('hex');
}

export async function verifyArchive(file: string): Promise<string> {
  const expected = (await Bun.file(file + '.sha256').text()).trim();
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== await digest(file)) {
    throw new Error('Release archive checksum mismatch: ' + file);
  }
  return expected;
}

export async function checkedAssets(directory: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const name of assetNames()) hashes[name] = await verifyArchive(directory + '/' + name);
  return hashes;
}

export function formula(hashes: Record<string, string>): string {
  const hash = hashes['devn.tgz'];
  if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Missing checksum for devn.tgz');
  return [
    'class Devn < Formula',
    '  desc "Project-aware Codex, Claude Code and OpenCode launcher for Bifrost"',
    '  homepage "https://github.com/' + repository + '"',
    '  url "https://github.com/' + repository + '/releases/download/v' + version + '/devn.tgz"',
    '  version "' + version + '"',
    '  sha256 "' + hash + '"',
    '  license "MIT"',
    '',
    '  depends_on "bun" => :build',
    '',
    '  on_linux do',
    '    # `bun build --compile` embeds the runtime, so the output inherits bun\'s ICU linkage.',
    '    depends_on "' + homebrewIcu + '"',
    '  end',
    '',
    '  def install',
    '    if OS.linux?',
    '      bun_icu = Formula["bun"].deps.find { |dep| dep.name.start_with?("icu4c") }.to_formula',
    '      icu = deps.find { |dep| dep.name.start_with?("icu4c") }.to_formula',
    '      odie "Update icu4c dependency!" if bun_icu.name != icu.name',
    '    end',
    '',
    '    # The caller\'s project must not inject a preload, environment file or config.',
    '    system "bun", "build", "src/main.ts", "--compile", "--minify",',
    '           "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",',
    '           "--no-compile-autoload-tsconfig", "--no-compile-autoload-package-json",',
    '           "--outfile", bin/"devn"',
    '  end',
    '',
    '  test do',
    '    assert_equal version.to_s, shell_output("#{bin}/devn --version").strip',
    '    assert_match "devn profile add", shell_output("#{bin}/devn --help")',
    '    ENV["XDG_CONFIG_HOME"] = (testpath/"config").to_s',
    '    (testpath/"project").mkpath',
    '    cd testpath/"project" do',
    '      # A caller-owned preload must not run inside devn.',
    '      (testpath/"project/evil.ts").write "await Bun.write(\'#{testpath}/preloaded\', \'x\')\\n"',
    '      (testpath/"project/bunfig.toml").write "preload = [\\"./evil.ts\\"]\\n"',
    '      assert_match "No profiles registered", shell_output("#{bin}/devn profile list")',
    '    end',
    '    refute_path_exists testpath/"preloaded"',
    '  end',
    'end',
    '',
  ].join('\n');
}

export function assertNoDowngrade(existing: string, next = version): void {
  const match = existing.match(/^\s*version "(\d+\.\d+\.\d+)"\s*$/m);
  if (!match) throw new Error('Cannot determine existing Formula version.');
  const oldParts = match[1].split('.').map(BigInt);
  const newParts = next.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (oldParts[i] > newParts[i]) throw new Error('Refusing to downgrade the Homebrew Formula.');
    if (oldParts[i] < newParts[i]) return;
  }
}
