$ErrorActionPreference = 'Stop'
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$registry = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$savedPath = $registry.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$savedKind = if ($null -ne $savedPath) { $registry.GetValueKind('Path') } else { $null }
$processPath = $env:PATH
try {
    $env:LOCALAPPDATA = Join-Path $p.temp 'child user'
    $env:DEVN_TEST_ARCHIVE = $p.archive
    # The outer cmd starts a fresh PowerShell. Inject only the ZIP transport mock before the
    # documented irm pipeline; the script itself is fetched by the real Invoke-RestMethod.
    $command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -c "function Invoke-WebRequest { param($Uri,$OutFile,$TimeoutSec,$ErrorAction,[switch]$UseBasicParsing) [IO.File]::Copy($env:DEVN_TEST_ARCHIVE,$OutFile) }; irm ' + $p.url + ' | iex"'
    # Let cmd parse the command itself instead of round-tripping its nested quotes through
    # PowerShell's native argument marshalling.
    [IO.File]::WriteAllText((Join-Path $p.temp 'install.cmd'), "@echo off`r`n" + $command + "`r`nexit /b %ERRORLEVEL%`r`n")
    Set-Location -LiteralPath $p.temp
    & $env:ComSpec /d /c install.cmd
    if ($LASTEXITCODE -ne 0) { throw 'cmd installer invocation failed' }
    if ($env:PATH -cne $processPath) { throw 'Child process unexpectedly changed parent PATH' }
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\devn'
    $updated = [string] $registry.GetValue('Path')
    if (-not $updated.Contains($installDir)) { throw 'Installer did not persist user PATH' }
    # Simulate a new terminal inheriting the refreshed user PATH.
    $env:PATH = $installDir + ';' + $processPath
    if ((& powershell.exe -NoProfile -Command 'devn --version') -ne $p.version) { throw 'New terminal cannot run installed devn' }
    Write-Host 'CMD_INSTALLER_TEST_PASSED'
} finally {
    if ($null -eq $savedPath) { $registry.DeleteValue('Path', $false) }
    else { $registry.SetValue('Path', $savedPath, $savedKind) }
    $registry.Dispose()
}
