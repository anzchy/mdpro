# Purpose: run native steps with durable phases, bounded child work and native lifetime guards.
# UIA and child planning finish before held input; ui-run supervises blocked OS calls.
# Contracts and budgets: ../../reference/ops.md. The full supervisor owns task/job cleanup.
param([string]$Steps, [string]$Out, [string]$RunId = ([guid]::NewGuid().ToString("N")),
      [long]$DeadlineMs = 0, [int]$PhaseMs = 5000, [int]$CleanupMs = 5000)
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\native-platform.ps1"
[void][W32]::SetProcessDPIAware()
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$script:mdproExe = if ($env:MDPRO_EXE) { $env:MDPRO_EXE } else { "D:\programs\mdpro\tauri-app.exe" }
. "$PSScriptRoot\native-runtime.ps1"
if ($env:MDPRO_NATIVE_JOB) { . "$PSScriptRoot\native-job.ps1" }
. "$PSScriptRoot\native-window.ps1"
. "$PSScriptRoot\native-input.ps1"
. "$PSScriptRoot\native-ops.ps1"
. "$PSScriptRoot\native-dialog.ps1"
. "$PSScriptRoot\native-dialog-receipt.ps1"
$failed = $false; $n = 0
foreach ($s in (Get-Content -Raw -Encoding UTF8 $Steps | ConvertFrom-Json)) {
  $n++
  $script:currentStep = $n; $script:currentOp = [string]$s.op
  try {
    Start-Phase ("op:" + $s.op)
    if ($null -ne $s.window -and $s.op -in @("windows", "visible", "showall", "wait", "open", "run", "tree")) { throw "IDENTITY_UNSUPPORTED_OP" }
    switch ($s.op) {
      "windows" { foreach ($w in MdproWindows) { L ("window '" + $w.Current.Name + "' hwnd=" + $w.Current.NativeWindowHandle + " rect=" + $w.Current.BoundingRectangle) } }
      "focus"   { Focus (Target $s); [void](Target $s $true); L "focused" }
      "max"     { $m = Target $s; [void][W32]::ShowWindow([IntPtr]$m.Current.NativeWindowHandle, 3); Start-Sleep -Milliseconds 400; L "maximized" }
      "menuinfo" { $h = [IntPtr](Target $s).Current.NativeWindowHandle; $m = [W32]::GetMenu($h); L ("hwnd=" + $h + " hmenu=" + $m + " count=" + [W32]::GetMenuItemCount($m) + " lastErr=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
      "visible" { foreach ($w in MdproWindows) { L ("visible=" + [W32]::IsWindowVisible([IntPtr]$w.Current.NativeWindowHandle)) } }
      "showall" { foreach ($p in Get-Process tauri-app -ErrorAction SilentlyContinue) { foreach ($h in [W32]::Tops([uint32]$p.Id)) { if ([W32]::Title($h) -ne "mdpro") { continue }; $was = [W32]::IsWindowVisible($h); if (-not $was) { [void][W32]::ShowWindow($h, 5) }; L ("hwnd=" + $h + " wasVisible=" + $was + " nowVisible=" + [W32]::IsWindowVisible($h)) } } }
      "restore" { $m = Target $s; [void][W32]::ShowWindow([IntPtr]$m.Current.NativeWindowHandle, 9); L "restored" }
      "layout" { Read-Layout $s }
      "setLayout" { Invoke-SetLayout $s }
      "keys" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "chord" { Invoke-LogicalChord $s }
      "physicalChord" { Invoke-PhysicalChord $s }
      "menus"   { $h = [IntPtr](Target $s).Current.NativeWindowHandle; DumpMenu ([W32]::GetMenu($h)) "" }
      "menu" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "click" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "settext" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "shot"    { $w = if ($s.screen) { $null } else { Target $s }; Shot $w $s.out $s.screen; L ("shot " + $s.out) }
      "wait"    { Start-Sleep -Milliseconds $s.ms }
      "filedialog" { Invoke-FileDialog $s }
      "dialogReceipt" { Invoke-DialogReceipt $s }
      "clickat" { $targetEl = Target $s; $pointRect = New-Object W32+RECT
                  if (-not [W32]::GetWindowRect([IntPtr]$targetEl.Current.NativeWindowHandle, [ref]$pointRect) -or
                      [int]$s.x -lt $pointRect.L -or [int]$s.x -ge $pointRect.R -or [int]$s.y -lt $pointRect.T -or [int]$s.y -ge $pointRect.B) { throw "IDENTITY_POINT_OUTSIDE" }
                  if (-not [W32]::SetCursorPos([int]$s.x, [int]$s.y)) { throw "IDENTITY_CURSOR_FAILED" }; Start-Sleep -Milliseconds 120; $f = if ($s.right) { 0x8, 0x10 } else { 0x2, 0x4 }
                  MouseClick $s $f[0] $f[1] ([int]$s.x) ([int]$s.y) $false; Start-Sleep -Milliseconds 300; L ("clickat " + $s.x + "," + $s.y) }
      "menuat"  {
        # Open a menu by its bar position and click an item, in ONE run (coordinates from a screen shot).
        Focus (Target $s); [void](Target $s $true)
        $points = @($s.bar, $s.item)
        for ($k = 0; $k -lt $points.Count; $k++) { $pt = $points[$k]
          if (-not [W32]::SetCursorPos([int]$pt[0], [int]$pt[1])) { throw "IDENTITY_CURSOR_FAILED" }; Start-Sleep -Milliseconds 150
          MouseClick $s 0x2 0x4 ([int]$pt[0]) ([int]$pt[1]) ($k -gt 0); Start-Sleep -Milliseconds 500 }
        L ("menuat bar=" + ($s.bar -join ",") + " item=" + ($s.item -join ","))
      }
      "menuclick" {
        # Real mouse clicks on the native menu: the top-level item, then the item in the dropdown.
        $h = [IntPtr](Target $s).Current.NativeWindowHandle; Focus (Target $s); [void](Target $s $true); $bar = [W32]::GetMenu($h); $m = $bar; $r = New-Object W32+RECT
        for ($k = 0; $k -lt $s.path.Count; $k++) {
          $name = $s.path[$k]; $hit = -1
          for ($i = 0; $i -lt [W32]::GetMenuItemCount($m); $i++) { if (((([W32]::Item($m, $i)) -split "`t")[0].Replace("&", "")) -eq $name) { $hit = $i; break } }
          if ($hit -lt 0) { throw "menu item not found: $name" }
          $owner = if ($k -eq 0) { $h } else { [IntPtr]::Zero }
          if (-not [W32]::GetMenuItemRect($owner, $m, [uint32]$hit, [ref]$r) -or $r.R -le $r.L -or $r.B -le $r.T) { throw "IDENTITY_MENU_RECT_INVALID" }
          $x = [int](($r.L + $r.R) / 2); $y = [int](($r.T + $r.B) / 2)
          if (-not [W32]::SetCursorPos($x, $y)) { throw "IDENTITY_CURSOR_FAILED" }; Start-Sleep -Milliseconds 150
          MouseClick $s 0x2 0x4 $x $y ($k -gt 0); Start-Sleep -Milliseconds 450
          L ("click '$name' at $x,$y")
          $sub = [W32]::GetSubMenu($m, $hit); if ($sub -ne [IntPtr]::Zero) { $m = $sub }
        }
      }
      "open"    { $exe = if ($env:MDPRO_EXE) { $env:MDPRO_EXE } else { "D:\programs\mdpro\tauri-app.exe" }; [NativeJobScope]::LaunchApp($exe, ('"' + $s.path + '"')); Start-Sleep -Milliseconds 1500; L ("opened " + $s.path) }
      "run"     { Start-Phase "run-helper"; [NativeJobScope]::RunHelper([string]$s.exe, [string]$s.args, [math]::Min($script:workDeadline, $script:phaseStartedMs + $PhaseMs)); L ("ran " + $s.exe) }
      "tree"    { $fg = [W32]::GetForegroundWindow(); $el = $AE::FromHandle($fg); L ("fg '" + $el.Current.Name + "'"); Tree $el ([int]$s.depth) "  " }
      default { throw "UI_OP_INVALID" }
    }
    $script:completedSteps = $n
    Complete-Phase
  } catch {
    $script:failedPhase = $script:phase
    L ("ERROR " + $s.op + ": " + $_.Exception.Message)
    if ($_.Exception.Message -match "IDENTITY_|PHYSICAL_|NATIVE_|UI_|LAYOUT_" -or $s.onError -ne "continue") { $failed = $true; L ("ABORTED at step " + $n); break }
  }
}
try {
  $layoutRestore = Restore-Layouts; Start-Phase "title-restore" -Cleanup
  foreach ($label in @($script:markers.Keys)) {
    $nonce = $script:markers[$label].nonce
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{ nonce = $nonce } | ConvertTo-Json -Compress)))
    $restored = Invoke-NodeBounded "title-restore" @("$PSScriptRoot\cdp.mjs", "--window", $label, "unbind", $b64) -Cleanup
    if ($LASTEXITCODE -ne 0 -or -not $restored) { throw "IDENTITY_TITLE_RESTORE_FAILED label=$label" }
  }
  foreach ($token in @($script:bindings.Values)) {
    if ($token.nativeKey -and [W32]::GetProp([IntPtr]([int64]$token.hwnd), $token.nativeKey).ToInt64().ToString() -ceq $token.nativeValue) {
      if ([W32]::RemoveProp([IntPtr]([int64]$token.hwnd), $token.nativeKey).ToInt64().ToString() -cne $token.nativeValue) { throw "IDENTITY_WINDOW_UNPIN_FAILED" }
    }
  }
  if ($layoutRestore) { throw $layoutRestore }; $script:cleanupState = "complete"
  Complete-Phase
} catch {
  L ("ERROR cleanup: " + $_.Exception.Message); $failed = $true; $script:cleanupState = "failed"
}
Finish-Outcome $failed
$log | ConvertTo-Json | Set-Content -Encoding UTF8 $Out
if ($failed) { exit 1 }
