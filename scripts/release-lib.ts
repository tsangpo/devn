import { version } from '../package.json';

export { version };
export const repository = 'tsangpo/devn';
export const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const;
export type Platform = typeof platforms[number];
export const archiveName = (platform: Platform) => 'devn-v' + version + '-' + platform + '.tar.gz';
export const assetNames = () => ['devn.tgz', ...platforms.map(archiveName)];

export function releaseTag(tag = process.env.RELEASE_TAG): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || tag !== 'v' + version) {
    throw new Error('Release tag must match the stable package.json version: v' + version);
  }
  return tag;
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
  const lines = [
    'class Devn < Formula',
    '  desc "Project-aware Codex and Claude Code launcher for Bifrost"',
    '  homepage "https://github.com/' + repository + '"',
    '  version "' + version + '"',
    '  license "MIT"',
  ];
  for (const os of ['darwin', 'linux']) {
    lines.push('', '  on_' + (os === 'darwin' ? 'macos' : 'linux') + ' do');
    for (const arch of ['arm64', 'x64']) {
      const name = archiveName((os + '-' + arch) as Platform);
      const hash = hashes[name];
      if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Missing checksum for ' + name);
      lines.push('    on_' + (arch === 'arm64' ? 'arm' : 'intel') + ' do',
        '      url "https://github.com/' + repository + '/releases/download/v' + version + '/' + name + '"',
        '      sha256 "' + hash + '"', '    end');
    }
    lines.push('  end');
  }
  lines.push('', '  def install', '    bin.install "devn"', '  end', '', '  test do',
    '    assert_equal version.to_s, shell_output("#{bin}/devn --version").strip',
    '    assert_match "devn profile add", shell_output("#{bin}/devn --help")',
    '    ENV["XDG_CONFIG_HOME"] = (testpath/"config").to_s',
    '    assert_match "No profiles registered", shell_output("#{bin}/devn profile list")',
    '  end', 'end', '');
  return lines.join('\n');
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
