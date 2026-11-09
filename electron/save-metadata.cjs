const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { systemPowerShell } = require('./windows-powershell.cjs');
const run = promisify(execFile);
const unavailable = () => new Error("Couldn't preserve this file's access permissions. Use Save As to choose a new file.");

const WINDOWS_ACCESS = `
$ErrorActionPreference = 'Stop'
# A PowerShell 7 parent can pass incompatible modules to Windows PowerShell 5.1.
$env:PSModulePath = "$PSHOME\\Modules"
if ($env:FOLIO_SAVE_SOURCE) {
  # Get-Acl omits mandatory labels and central access policies; refuse files that need them.
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FolioAccessPolicy {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetNamedSecurityInfo(string name, int type, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")]
  static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr sacl, out bool defaulted);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);
  public static bool Exists(string name) {
    IntPtr owner, group, dacl, sacl, descriptor;
    // LABEL | ATTRIBUTE | SCOPE use READ_CONTROL, without the audit privilege.
    uint error = GetNamedSecurityInfo(name, 1, 0x70, out owner, out group, out dacl, out sacl, out descriptor);
    if (error != 0) throw new System.ComponentModel.Win32Exception((int)error);
    try {
      bool present, defaulted;
      if (!GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted)) throw new InvalidOperationException("Cannot inspect access policy.");
      return present && sacl != IntPtr.Zero && Marshal.ReadInt16(sacl, 4) != 0;
    } finally { LocalFree(descriptor); }
  }
}
'@
  if ([FolioAccessPolicy]::Exists($env:FOLIO_SAVE_SOURCE) -or [FolioAccessPolicy]::Exists($env:FOLIO_SAVE_TEMP)) { throw 'Unsupported access policy. Use Save As.' }
  $acl = Get-Acl -LiteralPath $env:FOLIO_SAVE_SOURCE
} else {
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($identity)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
}
Set-Acl -LiteralPath $env:FOLIO_SAVE_TEMP -AclObject $acl
$actual = Get-Acl -LiteralPath $env:FOLIO_SAVE_TEMP
$sections = [Security.AccessControl.AccessControlSections]'Access, Owner, Group'
if ($env:FOLIO_SAVE_SOURCE) {
  $expected = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorSddlForm($sections))
  $observed = [Security.AccessControl.RawSecurityDescriptor]::new($actual.GetSecurityDescriptorSddlForm($sections))
  # Set-Acl may add the auto-inherited marker without changing any ACE or inheritance protection.
  foreach ($descriptor in @($expected, $observed)) {
    $descriptor.SetFlags([Security.AccessControl.ControlFlags]($descriptor.ControlFlags -band (-bnot 0x400)))
  }
  if ($observed.GetSddlForm($sections) -cne $expected.GetSddlForm($sections)) { throw 'Access permissions changed.' }
} elseif (-not $actual.AreAccessRulesProtected) { throw 'Access permissions changed.' }
`;

async function windowsAccess(temp, source) {
  await run(systemPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_ACCESS], {
    windowsHide: true, timeout: 15_000,
    env: { ...process.env, FOLIO_SAVE_SOURCE: source || '', FOLIO_SAVE_TEMP: temp },
  });
}

async function copySaveTemp(temp, file) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    if (process.platform === 'darwin') await run('/bin/chmod', ['-N', file], { timeout: 15_000 });
    if (process.platform === 'win32') await windowsAccess(file);
    await handle.writeFile(require('node:fs').createReadStream(temp));
    await handle.sync();
  } catch {
    // Another process may have replaced this path; leave it intact even after a failed write.
    throw new Error("Couldn't finish saving the new file. Check the destination file before retrying with Save As.");
  } finally { await handle.close(); }
}

async function createSaveTemp(root, source) {
  let folder, handle;
  try {
    // cp applies mode before ACLs; keep its intermediate inode inside a private folder.
    folder = await fs.mkdtemp(path.join(root, '.folio-'));
    await fs.chmod(folder, 0o700);
    if (process.platform === 'darwin') await run('/bin/chmod', ['-N', folder], { timeout: 15_000 });
    const temp = path.join(folder, 'save.tmp');
    handle = await fs.open(temp, 'wx', 0o600);
    if (process.platform === 'win32') {
      await windowsAccess(temp, source?.file);
    } else if (source) {
      if (process.platform === 'darwin') await run('/bin/cp', ['-pX', source.file, temp], { timeout: 30_000 });
      else if (process.platform === 'linux') await run('/bin/cp', ['--attributes-only', '--preserve=mode,ownership', '--', source.file, temp], { timeout: 15_000 });
      else throw unavailable();
      await handle.truncate(0);
    } else if (process.platform === 'darwin') await run('/bin/chmod', ['-N', temp], { timeout: 15_000 });
    const verify = async () => {
      if (process.platform === 'win32') return;
      const actual = await handle.stat({ bigint: true });
      if (source ? actual.uid !== source.stat.uid || actual.gid !== source.stat.gid || (actual.mode & 0o7777n) !== (source.stat.mode & 0o7777n)
        : (actual.mode & 0o777n) !== 0o600n) throw unavailable();
    };
    await verify();
    return { temp, handle, verify, cleanup: () => fs.rm(folder, { recursive: true, force: true }) };
  } catch {
    await handle?.close().catch(() => {});
    if (folder) await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
    throw unavailable();
  }
}
module.exports = { createSaveTemp, copySaveTemp };
