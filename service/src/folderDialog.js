import { execFile } from 'node:child_process';
import path from 'node:path';
import { conflict, lifecycleError } from './errors.js';

const PICK_TIMEOUT_MS = 10 * 60 * 1000;

export const WINDOWS_PICKER_SCRIPT = String.raw`
param([string]$Start = '', [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WaypointFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(); void GetParent();
    [PreserveSig] int GetDisplayName(uint sigdn, out IntPtr name);
    void GetAttributes(); void Compare();
  }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex(); void Advise(); void Unadvise();
    void SetOptions(uint fos); void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem item); void SetFolder(IShellItem item);
    void GetFolder(); void GetCurrentSelection(); void SetFileName(); void GetFileName();
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel();
    void GetResult(out IShellItem item);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr bind, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem item);
  public static string Pick(IntPtr owner, string start) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialog();
    uint options; dialog.GetOptions(out options);
    dialog.SetOptions(options | 0x20 | 0x40 | 0x800);
    dialog.SetTitle("Choose the project folder");
    dialog.SetOkButtonLabel("Select folder");
    if (!String.IsNullOrEmpty(start)) {
      try { IShellItem folder; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out folder); dialog.SetFolder(folder); } catch {}
    }
    if (dialog.Show(owner) != 0) return null;
    IShellItem result; dialog.GetResult(out result);
    IntPtr name; result.GetDisplayName(0x80058000, out name);
    string picked = Marshal.PtrToStringUni(name);
    Marshal.FreeCoTaskMem(name);
    return picked;
  }
}
"@
if ($CheckOnly) { 'ok'; exit 0 }
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$owner.Show()
$owner.Activate()
try {
  $picked = [WaypointFolderPicker]::Pick($owner.Handle, $Start)
  if ($picked) { [Console]::Out.Write($picked) }
} finally { $owner.Close() }
`;

function defaultRunner(command, args, options) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: options.timeoutMs, windowsHide: false, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), timedOut: Boolean(error?.killed) });
    });
  });
}

export function pickerCommand(platform, start = '', { checkOnly = false } = {}) {
  if (platform === 'win32') {
    const script = `& { ${WINDOWS_PICKER_SCRIPT} } -Start ${quotePs(start)}${checkOnly ? ' -CheckOnly' : ''}`;
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
  }
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', `POSIX path of (choose folder with prompt "Choose the project folder"${start ? ` default location (POSIX file ${JSON.stringify(start)})` : ''})`] };
  return { command: 'zenity', args: ['--file-selection', '--directory', '--title=Choose the project folder', ...(start ? [`--filename=${start.replace(/\/?$/, '/')}`] : [])] };
}

function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export class FolderDialog {
  constructor({ platform = process.platform, runner = defaultRunner } = {}) {
    this.platform = platform;
    this.runner = runner;
    this.open = false;
  }

  async pick({ start = '' } = {}) {
    if (this.open) throw conflict('A folder picker is already open on this computer.');
    this.open = true;
    try {
      const from = String(start || '').trim().slice(0, 1000);
      const { command, args } = pickerCommand(this.platform, from && path.isAbsolute(from) ? from : '');
      const result = await this.runner(command, args, { timeoutMs: PICK_TIMEOUT_MS });
      if (result.timedOut) return { path: null, cancelled: true };
      const output = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('<') && !line.startsWith('#<')).pop() || '';
      const picked = /^[A-Za-z]:[\\/]$|^\/$/.test(output) ? output : output.replace(/[\\/]$/, '');
      if (picked && path.isAbsolute(picked)) return { path: picked, cancelled: false };
      if (result.code === 0 || result.code === 1) return { path: null, cancelled: true };
      throw lifecycleError('The folder picker could not be opened on this computer.');
    } finally { this.open = false; }
  }
}
