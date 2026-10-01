import { archiveName, digest, verifyArchive, version } from './release-lib';

export async function renderInstaller(hash: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid Windows archive SHA-256.');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Installer requires a stable version.');
  const template = await Bun.file(new URL('./install.ps1', import.meta.url)).text();
  return template.replace('@@VERSION@@', version)
    .replace('@@ARCHIVE@@', archiveName('windows-x64')).replace('@@SHA256@@', hash);
}

if (import.meta.main) {
  const hash = await verifyArchive('release/' + archiveName('windows-x64'));
  await Bun.write('release/install.ps1', await renderInstaller(hash));
  await Bun.write('release/install.ps1.sha256', await digest('release/install.ps1') + '\n');
  console.log('Prepared Windows installer for devn ' + version);
}
