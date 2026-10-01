# Generated for a specific release. Keep this template compatible with Windows PowerShell 5.1.
& {
    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version 2.0
    $version = '@@VERSION@@'
    $archiveName = '@@ARCHIVE@@'
    $expectedHash = '@@SHA256@@'
    $downloadUrl = 'https://github.com/tsangpo/devn/releases/download/v' + $version + '/' + $archiveName

    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'devn installer requires Windows x64.'
    }
    if (-not [Environment]::Is64BitProcess) {
        throw 'Use 64-bit PowerShell on Windows x64 to install devn.'
    }
    # Environment architecture variables describe the emulated process on ARM64.
    if (-not ('DevnInstaller.NativeSystem' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace DevnInstaller {
    public static class NativeSystem {
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr SendMessageTimeout(IntPtr window, uint message,
            UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
        public static ushort Architecture() {
            ushort processMachine, nativeMachine;
            if (!IsWow64Process2(new IntPtr(-1), out processMachine, out nativeMachine))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return nativeMachine;
        }
        public static void NotifyEnvironmentChange() {
            UIntPtr result;
            SendMessageTimeout(new IntPtr(0xffff), 0x001a, UIntPtr.Zero,
                "Environment", 2, 5000, out result);
        }
    }
}
'@
    }
    if ([DevnInstaller.NativeSystem]::Architecture() -ne 0x8664) {
        throw 'devn supports Windows x64 only; Windows ARM64 is not supported.'
    }
    if ($version -notmatch '^\d+\.\d+\.\d+$' -or $expectedHash -notmatch '^[a-f0-9]{64}$') {
        throw 'Invalid installer release metadata. Download install.ps1 from a published devn release.'
    }

    function Test-DevnPathEntry([string] $pathValue, [string] $directory) {
        foreach ($entry in ($pathValue -split ';')) {
            $expanded = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"')).TrimEnd('\')
            if ($expanded -ieq $directory.TrimEnd('\')) { return $true }
        }
        return $false
    }

    function Assert-DevnVersion([string] $executable) {
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $executable
        $info.Arguments = '--version'
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $info
        try {
            [void] $process.Start()
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(30000)) {
                $process.Kill()
                $process.WaitForExit()
                throw 'devn --version timed out.'
            }
            if ($process.ExitCode -ne 0 -or $stdout.Result.Trim() -cne $version) {
                throw ('Downloaded devn failed version verification: ' + $stderr.Result)
            }
        } finally { $process.Dispose() }
    }

    $localAppData = $env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $localAppData = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData\Local'
    }
    $installDir = [IO.Path]::GetFullPath((Join-Path $localAppData 'Programs\devn'))
    $executable = Join-Path $installDir 'devn.exe'
    [void] [IO.Directory]::CreateDirectory($installDir)
    $lock = $null
    $work = $null
    $keepBackup = $false
    try {
        try {
            # Retain the lock file: deleting it after closing introduces a race with another installer.
            $lock = [IO.File]::Open((Join-Path $installDir '.install.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        } catch { throw ('Another installer is running, or the install directory is not writable: ' + $installDir) }
        # Stage on the destination volume so replacement and rollback can use File.Replace.
        $work = Join-Path $installDir ('.install-' + [Guid]::NewGuid().ToString('N'))
        [void] [IO.Directory]::CreateDirectory($work)
        $archive = Join-Path $work $archiveName
        Write-Host ('Downloading devn ' + $version + '...')
        Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archive -TimeoutSec 120 -ErrorAction Stop
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $expectedHash) {
            throw 'devn archive SHA-256 checksum mismatch. Existing installation was not changed.'
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            $names = @($zip.Entries | ForEach-Object { $_.FullName })
            if ($names.Count -ne 2 -or -not ($names -ccontains 'LICENSE') -or -not ($names -ccontains 'devn.exe')) {
                throw 'Unexpected devn archive contents; expected only devn.exe and LICENSE.'
            }
        } finally { $zip.Dispose() }
        $staging = Join-Path $work 'files'
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
        Assert-DevnVersion (Join-Path $staging 'devn.exe')

        $applied = New-Object 'System.Collections.Generic.List[object]'
        try {
            foreach ($name in @('devn.exe', 'LICENSE')) {
                $source = Join-Path $staging $name
                $destination = Join-Path $installDir $name
                $backup = Join-Path $work ($name + '.backup')
                $existed = [IO.File]::Exists($destination)
                if ($existed) { [IO.File]::Replace($source, $destination, $backup) }
                else { [IO.File]::Move($source, $destination) }
                $applied.Add(@{ Destination = $destination; Backup = $backup; Existed = $existed })
            }
            Assert-DevnVersion $executable
        } catch {
            $installError = $_
            for ($i = $applied.Count - 1; $i -ge 0; $i--) {
                $item = $applied[$i]
                try {
                    if ($item.Existed) { [IO.File]::Replace($item.Backup, $item.Destination, [NullString]::Value) }
                    else { [IO.File]::Delete($item.Destination) }
                } catch { $keepBackup = $true }
            }
            if ($keepBackup) { throw ('Installation and rollback failed. Backups retained at ' + $work + '. ' + $installError) }
            throw ('Installation failed; previous files were preserved. Close running devn processes and retry. ' + $installError)
        }

        $key = $null
        try {
            $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
            $userPath = [string] $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            if (-not (Test-DevnPathEntry $userPath $installDir)) {
                $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
                if ($null -ne $key.GetValue('Path')) { $kind = $key.GetValueKind('Path') }
                $separator = if ($userPath.Length -gt 0 -and -not $userPath.EndsWith(';')) { ';' } else { '' }
                $key.SetValue('Path', ($userPath + $separator + $installDir), $kind)
            }
        } catch {
            throw ('devn files installed at ' + $installDir + ', but user PATH could not be updated. Add this directory to your user PATH manually. ' + $_)
        } finally { if ($null -ne $key) { $key.Dispose() } }
        [DevnInstaller.NativeSystem]::NotifyEnvironmentChange()
        if (-not (Test-DevnPathEntry $env:PATH $installDir)) {
            $env:PATH = $env:PATH + ';' + $installDir
        }
        $command = Get-Command devn -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $command -and $command.Source -ine $executable) {
            Write-Warning ('Another devn command takes precedence: ' + $command.Definition + '. Adjust PATH or invoke ' + $executable + ' directly.')
        }
        Write-Host ('Installed devn ' + $version + ' at ' + $installDir)
        Write-Host 'Run devn --version to verify. Re-run this installer to upgrade.'
        Write-Host 'If launched through powershell -c, reopen your terminal before using devn.'
    } finally {
        if ($null -ne $work -and -not $keepBackup) {
            try { if ([IO.Directory]::Exists($work)) { [IO.Directory]::Delete($work, $true) } }
            catch { Write-Warning ('Could not remove installer temporary directory: ' + $work) }
        }
        if ($null -ne $lock) { $lock.Dispose() }
    }
}
