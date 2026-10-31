// Process identity for the native-reconcile fixtures when pwsh runs on Linux (CI).
//
// native-reconcile.ps1 matches an owned member by pid, birth and exe, with birth read as
// Process.StartTime ticks. On Windows that is the kernel's creation time, exact in every reader.
// On Linux, .NET adds the process's jiffy start to a boot time each process computes for itself,
// so two pwsh processes read one live process's StartTime microseconds apart. pwsh 7.6.9 / .NET 10,
// ubuntu 24.04 arm64, three reads of one `sleep`: 639290258021584360, …584429, …584517 (one
// process reading it three times gets one value). An exact match then never holds across processes,
// and a live member looks like a reused pid. This substitutes the kernel's own counters, which every
// reader sees alike, for that one observation; the matching itself stays the product's.

/** PowerShell: a process's start, in .NET ticks, from /proc/<pid>/stat starttime and /proc/stat btime. */
export const linuxStartTicks = String.raw`function Get-LinuxStartTicks([int]$Id) {
  $stat = [IO.File]::ReadAllText("/proc/$Id/stat")
  $fields = $stat.Substring($stat.LastIndexOf(')') + 2).Split(' ')
  $btime = [long]((@([IO.File]::ReadAllLines('/proc/stat')) -match '^btime ')[0].Split(' ')[1])
  [long]621355968000000000 + $btime * [long]10000000 + [long]$fields[19] * [long]10000000 / [long](getconf CLK_TCK)
}`;

/**
 * PowerShell, prepended to the fixture's copy of native-reconcile.ps1: on Linux only, Get-Process -Id returns
 * the process's Id and Path with its kernel start time; a process gone mid-read is absent, as with
 * -ErrorAction SilentlyContinue. Elsewhere it is the real cmdlet.
 */
export const reconcileProcessBoundary = linuxStartTicks + String.raw`
function Get-Process {
  param([int]$Id, [Management.Automation.ActionPreference]$ErrorAction = 'Continue')
  $p = Microsoft.PowerShell.Management\Get-Process -Id $Id -ErrorAction $ErrorAction
  if (-not $p -or -not $IsLinux) { return $p }
  try { $ticks = Get-LinuxStartTicks $Id } catch { return $null }
  [pscustomobject]@{ Id = $p.Id; Path = $p.Path; StartTime = [DateTime]::new($ticks, [DateTimeKind]::Utc) }
}
`;
