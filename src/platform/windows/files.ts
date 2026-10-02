import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { powershell } from './system';

// Construct a new protected DACL: neither inherited nor unrelated explicit grants survive.
const protect = `
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$item = Get-Item -LiteralPath $p.path -Force
if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point refused' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
if ($item.PSIsContainer) {
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $flags = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} else {
  $acl = [Security.AccessControl.FileSecurity]::new()
  $flags = [Security.AccessControl.InheritanceFlags]::None
}
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in @($sid, $system)) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', $flags, 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
# Persist only the modified owner/DACL sections. Set-Acl can also request SACL
# access on an already protected directory, requiring SeSecurityPrivilege.
$item.SetAccessControl($acl)
$actual = Get-Acl -LiteralPath $p.path
if (!$actual.AreAccessRulesProtected) { throw 'ACL inheritance remains enabled' }
$rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($rules.Count -ne 2) { throw 'Unexpected ACL rules' }
foreach ($rule in $rules) {
  if ($rule.IdentityReference.Value -notin @($sid.Value, $system.Value) -or
      $rule.AccessControlType -ne 'Allow' -or $rule.IsInherited -or
      $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Unexpected ACL grant' }
}
`;

function rejectLinks(file: string): void {
  let current = path.resolve(file);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Refusing symlink or junction in private configuration path.');
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function privateDir(dir: string): void {
  rejectLinks(dir);
  fs.mkdirSync(dir, { recursive: true });
  powershell(protect, { path: path.resolve(dir) });
}

export function privateFile(file: string): void {
  rejectLinks(file);
  powershell(protect, { path: path.resolve(file) });
}

export function replaceFile(temp: string, target: string): void {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temp, target); return; }
    catch (error: any) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      Bun.sleepSync(50);
    }
  }
}

export function atomicWrite(file: string, content: string): void {
  rejectLinks(file);
  privateDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    // Never write plaintext until both the enclosing directory and the file are protected.
    fs.closeSync(fs.openSync(temp, 'wx'));
    privateFile(temp);
    fs.writeFileSync(temp, content);
    replaceFile(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}
