Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MarkLShell {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@
[MarkLShell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
$ie4 = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
if (Test-Path $ie4) { & $ie4 -show | Out-Null }
