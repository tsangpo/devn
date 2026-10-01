import { powershell } from '../../../src/platform/windows/system';

export function pack(archive: string, directory: string): void {
  powershell(`
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $p.archive) { Remove-Item -LiteralPath $p.archive }
[IO.Compression.ZipFile]::CreateFromDirectory($p.directory, $p.archive)
`, { archive, directory });
}
export function entries(archive: string): string[] {
  return JSON.parse(powershell(`
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($p.archive)
try { ConvertTo-Json -InputObject @($zip.Entries | ForEach-Object { $_.FullName }) -Compress }
finally { $zip.Dispose() }
`, { archive }));
}
export function extract(archive: string, directory: string): void {
  powershell(`
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($p.archive, $p.directory)
`, { archive, directory });
}
