$ErrorActionPreference = 'Stop'
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$installer = [IO.File]::ReadAllText($p.installer)
$registry = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$savedPath = $registry.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$savedKind = if ($null -ne $savedPath) { $registry.GetValueKind('Path') } else { $null }
$originalProcessPath = $env:PATH
$originalLocalAppData = $env:LOCALAPPDATA
$script:download = $p.archive
$script:networkFailure = ''
$script:requests = 0
$script:expectedVersion = $p.version

function Assert($condition, [string] $message) {
    if (-not $condition) { throw $message }
}
function Invoke-WebRequest {
    param($Uri, $OutFile, $TimeoutSec, $ErrorAction, [switch] $UseBasicParsing)
    Assert ($Uri -ceq ('https://github.com/tsangpo/devn/releases/download/v' + $script:expectedVersion + '/devn-v' + $script:expectedVersion + '-windows-x64.zip')) 'Download must use a pinned version URL'
    Assert ($TimeoutSec -eq 120 -and $UseBasicParsing) 'Download must have a timeout and support PowerShell 5.1'
    $script:requests++
    if ($script:networkFailure) { throw $script:networkFailure }
    [IO.File]::Copy($script:download, $OutFile)
}
function Invoke-RestMethod {
    param($Uri)
    Assert ($Uri -ceq 'https://github.com/tsangpo/devn/releases/latest/download/install.ps1') 'Unexpected installer URL'
    return $installer
}
function UserPath { return [string] $registry.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
function Expect-Failure([string] $source, [string] $message) {
    $caught = $false
    try { Invoke-Expression $source } catch {
        Assert ($_.ToString().Contains($message)) ('Unexpected error: ' + $_)
        $caught = $true
    }
    Assert $caught ('Expected failure: ' + $message)
}
function Assert-Clean {
    Assert (@(Get-ChildItem -LiteralPath $installDir -Directory -Filter '.install-*').Count -eq 0) 'Staging directory leaked'
}
try {
    $env:LOCALAPPDATA = Join-Path $p.temp ('user space ' + [char]0x7528 + [char]0x6237)
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\devn'
    $exe = Join-Path $installDir 'devn.exe'
    $license = Join-Path $installDir 'LICENSE'
    $registry.SetValue('Path', '%USERPROFILE%\existing;', [Microsoft.Win32.RegistryValueKind]::ExpandString)
    $script:networkFailure = 'First install download failed'
    Expect-Failure $installer $script:networkFailure
    Assert (-not [IO.File]::Exists($exe)) 'Failed first installation left an EXE'
    Assert ((UserPath) -ceq '%USERPROFILE%\existing;') 'Failed first installation modified PATH'
    Assert-Clean
    $script:networkFailure = ''
    $preference = $ErrorActionPreference
    irm https://github.com/tsangpo/devn/releases/latest/download/install.ps1 | iex
    Assert ($ErrorActionPreference -eq $preference) 'Installer leaked preference changes'
    Assert ((& $exe --version) -eq $p.version) 'First installation failed'
    Assert ((UserPath) -ceq ('%USERPROFILE%\existing;' + $installDir)) 'User PATH contents were not preserved'
    Assert ($env:PATH.Contains($installDir)) 'Current session PATH was not updated'
    Assert-Clean

    # Reinstall with an equivalent PATH entry: preserve spelling, variables, quotes and value kind.
    $duplicatePath = '%USERPROFILE%\existing;"' + $installDir.ToUpperInvariant() + '\"'
    $registry.SetValue('Path', $duplicatePath, [Microsoft.Win32.RegistryValueKind]::String)
    Invoke-Expression $installer
    Assert ((UserPath) -ceq $duplicatePath) 'Duplicate PATH entry was appended'
    Assert ($registry.GetValueKind('Path') -eq [Microsoft.Win32.RegistryValueKind]::String) 'PATH value kind changed'

    [IO.File]::Copy($p.oldExe, $exe, $true)
    [IO.File]::WriteAllText($license, 'old license')
    Invoke-Expression $installer
    Assert ((& $exe --version) -eq $p.version) 'Upgrade did not replace old version'
    Assert ([IO.File]::ReadAllText($license) -ne 'old license') 'Upgrade did not replace license'

    # All subsequent failures must preserve a genuinely older installation and the user PATH.
    [IO.File]::Copy($p.oldExe, $exe, $true)
    [IO.File]::WriteAllText($license, 'old license')
    $oldHash = (Get-FileHash -LiteralPath $exe).Hash
    foreach ($failure in @('Download failed: HTTP 404', 'Download timed out')) {
        $script:networkFailure = $failure
        Expect-Failure $installer $failure
        Assert-Clean
    }
    $script:networkFailure = ''
    Expect-Failure ($installer.Replace($p.hash, ('0' * 64))) 'checksum mismatch'
    # A valid checksum with a different expected runtime version must not replace the old EXE.
    $script:expectedVersion = '999.0.0'
    Expect-Failure ($installer.Replace($p.version, $script:expectedVersion)) 'version verification'
    $script:expectedVersion = $p.version

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $invalid = Join-Path $p.temp 'invalid.zip'
    $zip = [IO.Compression.ZipFile]::Open($invalid, [IO.Compression.ZipArchiveMode]::Create)
    try { [void] $zip.CreateEntry('../devn.exe'); [void] $zip.CreateEntry('LICENSE') } finally { $zip.Dispose() }
    $script:download = $invalid
    $invalidHash = (Get-FileHash -LiteralPath $invalid).Hash.ToLowerInvariant()
    Expect-Failure ($installer.Replace($p.hash, $invalidHash)) 'Unexpected devn archive contents'
    $script:download = $p.archive

    $held = [IO.File]::Open($exe, 'Open', 'Read', 'None')
    try { Expect-Failure $installer 'previous files were preserved' } finally { $held.Dispose() }
    # Fail the second replacement, after the EXE was already updated, to exercise rollback.
    $held = [IO.File]::Open($license, 'Open', 'Read', 'None')
    try { Expect-Failure $installer 'previous files were preserved' } finally { $held.Dispose() }
    Assert ((Get-FileHash -LiteralPath $exe).Hash -eq $oldHash) 'Failure damaged the old EXE'
    Assert ([IO.File]::ReadAllText($license) -ceq 'old license') 'Failure damaged the old license'
    Assert ((UserPath) -ceq $duplicatePath) 'Failure modified the user PATH'
    Assert-Clean

    $held = [IO.File]::Open((Join-Path $installDir '.install.lock'), 'Open', 'ReadWrite', 'None')
    try { Expect-Failure $installer 'Another installer is running' } finally { $held.Dispose() }
    # Simulate unsupported native architecture without changing the download or filesystem logic.
    $before = $script:requests
    Expect-Failure ($installer.Replace('[DevnInstaller.NativeSystem]::Architecture() -ne 0x8664', '0xaa64 -ne 0x8664')) 'Windows ARM64 is not supported'
    Expect-Failure ($installer.Replace('[Environment]::Is64BitProcess', '$false')) '64-bit PowerShell'
    Assert ($script:requests -eq $before) 'Unsupported architecture initiated a download'

    function devn { 'shadowed' }
    $warnings = @(Invoke-Expression $installer 3>&1 | Where-Object { $_ -is [Management.Automation.WarningRecord] })
    Assert (@($warnings | Where-Object { $_.Message.Contains('takes precedence') }).Count -eq 1) 'Shadowed command was not reported'
    Assert-Clean
    Write-Host 'INSTALLER_TESTS_PASSED'
} finally {
    if ($null -eq $savedPath) { $registry.DeleteValue('Path', $false) }
    else { $registry.SetValue('Path', $savedPath, $savedKind) }
    $registry.Dispose()
    $env:PATH = $originalProcessPath
    $env:LOCALAPPDATA = $originalLocalAppData
    if ('DevnInstaller.NativeSystem' -as [type]) { [DevnInstaller.NativeSystem]::NotifyEnvironmentChange() }
}
