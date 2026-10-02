# Run the probe without the privilege elevated CI runners normally inherit.
$ErrorActionPreference = 'Stop'
[Environment]::SetEnvironmentVariable('PSModulePath', $PSHOME + '\Modules', 'Process')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DevnTestPrivileges {
    [StructLayout(LayoutKind.Sequential)]
    struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)]
    struct TokenPrivileges { public uint Count; public Luid Id; public uint Attributes; }
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool LookupPrivilegeValue(string system, string name, out Luid luid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll,
        ref TokenPrivileges privileges, uint length, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);
    public static void RemoveSecurityPrivilege() {
        IntPtr token;
        if (!OpenProcessToken(new IntPtr(-1), 0x28, out token))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {
            var privileges = new TokenPrivileges { Count = 1, Attributes = 4 };
            if (!LookupPrivilegeValue(null, "SeSecurityPrivilege", out privileges.Id) ||
                !AdjustTokenPrivileges(token, false, ref privileges, 0, IntPtr.Zero, IntPtr.Zero))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            int error = Marshal.GetLastWin32Error();
            // ERROR_NOT_ALL_ASSIGNED also means the privilege was already absent.
            if (error != 0 && error != 1300)
                throw new System.ComponentModel.Win32Exception(error);
        } finally { CloseHandle(token); }
    }
}
'@
[DevnTestPrivileges]::RemoveSecurityPrivilege()
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
& $p.bun $p.probe
exit $LASTEXITCODE
