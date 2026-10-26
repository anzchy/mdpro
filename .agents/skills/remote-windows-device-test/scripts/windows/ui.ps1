# Purpose: drive mdpro's native window from the user's interactive desktop session
# (SSH has no desktop). Reads a JSON step list, runs each step, writes a JSON log.
# Run it through ui-run.ps1 (Mac side: scripts/mac/ui.sh), never directly over SSH.
# Steps: see ../../reference/ops.md (kept in sync with this file). Every step logs one line. An
# error logs "ERROR <op>: ..." and stops the run with "ABORTED at step N", so a step that depends on
# it never runs; the log is still written, and the script exits 1. A step with "onError":"continue"
# (for read-only steps such as windows or tree) logs its error and the run goes on.
# Rule: a native menu must be opened AND its item clicked inside ONE run (menuclick / menuat) —
# starting the next run's scheduled task dismisses any menu the previous run left open.
param([string]$Steps, [string]$Out)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint threadId);
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo;
  }
  // INPUT's union is 32 bytes on x64; the keyboard member begins at offset 8.
  [StructLayout(LayoutKind.Explicit, Size=40)] public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public KEYBDINPUT ki;
  }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public static uint SendScan(ushort scan, bool up, bool extended) {
    var input = new INPUT { type = 1, ki = new KEYBDINPUT {
      wVk = 0, wScan = scan, dwFlags = (uint)(0x8 | (up ? 0x2 : 0) | (extended ? 0x1 : 0)) } };
    return SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  // Top-level, unowned windows of a process, hidden ones included (MainWindowHandle is 0 while hidden).
  public static System.Collections.Generic.List<IntPtr> Tops(uint pid) { var r = new System.Collections.Generic.List<IntPtr>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && GetWindow(h, 4) == IntPtr.Zero) r.Add(h); return true; }, IntPtr.Zero); return r; }
  public static string Title(IntPtr h) { var sb = new System.Text.StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr m, int i);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr m, int i);
  [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr m, uint id, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr m, uint id, System.Text.StringBuilder s, int max, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  public static string ClassName(IntPtr h) { var s = new System.Text.StringBuilder(256); return GetClassName(h, s, 256) > 0 ? s.ToString() : ""; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public uint cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
  }
  [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);
  public static IntPtr MenuOwner(uint threadId) {
    var info = new GUITHREADINFO { cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO)) };
    return GetGUIThreadInfo(threadId, ref info) ? info.hwndMenuOwner : IntPtr.Zero;
  }
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetMenuItemRect(IntPtr h, IntPtr m, uint i, out RECT r);
  public static string Item(IntPtr m, int i) { var sb = new System.Text.StringBuilder(256); GetMenuString(m, (uint)i, sb, 256, 0x400); return sb.ToString(); }
  public struct RECT { public int L, T, R, B; }
}
"@
[void][W32]::SetProcessDPIAware()
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$script:mdproExe = if ($env:MDPRO_EXE) { $env:MDPRO_EXE } else { "D:\programs\mdpro\tauri-app.exe" }
$log = New-Object System.Collections.ArrayList
function L($o) { [void]$log.Add($o) }
function MdproWindows {
  $ids = @(Get-Process tauri-app -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $script:mdproExe } | ForEach-Object { $_.Id })
  $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
  $AE::RootElement.FindAll($TS::Children, $c) | Where-Object { $ids -contains $_.Current.ProcessId }
}
# The Node resolver is the same decision code exercised on Mac. Windows supplies fresh Win32
# observations before every input; the token pins a labelled run to its original HWND and process.
$script:bindings = @{}
$script:markers = @{}
function ValidateNative($token, [bool]$foreground) {
  $h = [IntPtr]([int64]::Parse($token.hwnd)); $nativePid = [uint32]0
  $thread = [W32]::GetWindowThreadProcessId($h, [ref]$nativePid)
  if ($thread -eq 0 -or [int]$nativePid -ne [int]$token.pid -or -not [W32]::IsWindowVisible($h)) { throw "IDENTITY_NATIVE_STALE" }
  $p = Get-Process -Id $nativePid -ErrorAction Stop
  if ($p.Path -ine $script:mdproExe) { throw "IDENTITY_PROCESS_PATH" }
  $r = New-Object W32+RECT
  if (-not [W32]::GetWindowRect($h, [ref]$r) -or
      (@($r.L, $r.T, $r.R, $r.B) -join ",") -ne (@($token.rect) -join ",")) { throw "IDENTITY_NATIVE_RECT_CHANGED" }
  if ($token.challenge -and [W32]::Title($h) -cne [string]$token.challenge) { throw "IDENTITY_NATIVE_CHALLENGE_CHANGED" }
  if ($foreground -and [W32]::GetForegroundWindow() -ne $h) { throw "IDENTITY_NATIVE_FOREGROUND_CHANGED" }
  return $thread
}
function Target($step, [bool]$foreground = $false) {
  try {
  $label = if ($null -ne $step.window) { [string]$step.window } else { $null }
  if ($null -ne $label -and $null -eq $step._identity) { throw "IDENTITY_READ_MISSING" }
  if ($null -ne $label -and -not $script:markers.ContainsKey($label)) {
    $record = @($step._identity | Where-Object { $_.label -ceq $label })
    if ($record.Count -ne 1) { throw "IDENTITY_LABEL_NOT_UNIQUE" }
    $nonce = [guid]::NewGuid().ToString("N")
    $script:markers[$label] = @{ nonce = $nonce; challenge = $null }
    if (-not $record[0].pageId) { throw "IDENTITY_PAGE_ID_MISSING" }
    $request = @{ rect = @($record[0].rect); pageId = [string]$record[0].pageId; nonce = $nonce } | ConvertTo-Json -Compress -Depth 5
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($request))
    $marked = & node "$PSScriptRoot\cdp.mjs" --window $label bind $b64
    if ($LASTEXITCODE -ne 0 -or -not $marked) { throw "IDENTITY_TITLE_BIND_FAILED" }
    $mark = $marked | ConvertFrom-Json
    if ($mark.label -cne $label -or -not $mark.challenge) { throw "IDENTITY_TITLE_BIND_INVALID" }
    $script:markers[$label].challenge = [string]$mark.challenge
  }
  $windows = @()
  $elements = @(MdproWindows)
  foreach ($el in $elements) {
    $h = [IntPtr]$el.Current.NativeWindowHandle; $windowPid = [uint32]0; [void][W32]::GetWindowThreadProcessId($h, [ref]$windowPid)
    $process = Get-Process -Id $windowPid -ErrorAction Stop
    $r = New-Object W32+RECT
    if (-not [W32]::GetWindowRect($h, [ref]$r) -or [int]$el.Current.ProcessId -ne [int]$windowPid) { throw "IDENTITY_RECT_OR_PROCESS_READ_FAILED" }
    $windows += @{ hwnd = $h.ToInt64().ToString(); pid = [int]$windowPid; exe = [string]$process.Path; title = [W32]::Title($h); visible = [W32]::IsWindowVisible($h);
                   rect = @($r.L, $r.T, $r.R, $r.B) }
  }
  $key = if ($null -ne $label) { "label:$label" } else { "sole" }
  $records = @()
  if ($null -ne $label) { $records = @($step._identity) }
  $bindingArgs = @{ label = $label; records = $records; expectedExe = $script:mdproExe;
              windows = $windows; foreground = ([W32]::GetForegroundWindow()).ToInt64().ToString();
              requireForeground = $foreground }
  if ($null -ne $label) { $bindingArgs.challenge = $script:markers[$label].challenge }
  if ($script:bindings.ContainsKey($key)) { $bindingArgs.expected = $script:bindings[$key] }
  $json = $bindingArgs | ConvertTo-Json -Compress -Depth 12
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
  $answer = & node "$PSScriptRoot\window-binding.mjs" $encoded
  if ($LASTEXITCODE -ne 0 -or -not $answer) { throw "IDENTITY_REJECTED" }
  $token = $answer | ConvertFrom-Json
  $hit = @($elements | Where-Object { [string]$_.Current.NativeWindowHandle -eq $token.hwnd -and [int]$_.Current.ProcessId -eq $token.pid })
  if ($hit.Count -ne 1) { throw "IDENTITY_ELEMENT_STALE" }
  $token | Add-Member -NotePropertyName challenge -NotePropertyValue $bindingArgs.challenge -Force
  [void](ValidateNative $token $foreground)
  if (-not $script:bindings.ContainsKey($key)) {
    L ("bound label=" + $token.label + " hwnd=" + $token.hwnd + " pid=" + $token.pid +
       " rect=" + ($token.rect -join ",") + " foreground=" + $bindingArgs.foreground)
  }
  $script:bindings[$key] = $token
  return $hit[0]
  } catch { throw "IDENTITY_FAILURE: $($_.Exception.Message)" }
}
function Focus($el) {
  $h = [IntPtr]$el.Current.NativeWindowHandle
  if ([W32]::GetForegroundWindow() -eq $h) { return }
  if (-not [W32]::SetForegroundWindow($h)) { throw "IDENTITY_FOCUS_REFUSED" }
  Start-Sleep -Milliseconds 250
  if ([W32]::GetForegroundWindow() -ne $h) { throw "IDENTITY_FOCUS_REFUSED" }
}
function MousePoint($step, [int]$x, [int]$y, [bool]$popup, [bool]$afterDown = $false) {
  $el = Target $step $true # resolver may run Node; no cursor observation before it is authoritative
  $h = [IntPtr]$el.Current.NativeWindowHandle
  $point = New-Object W32+POINT
  if (-not [W32]::GetCursorPos([ref]$point)) { throw "IDENTITY_CURSOR_READ_FAILED" }
  if ($point.X -ne $x -or $point.Y -ne $y) { throw "IDENTITY_CURSOR_MOVED" }
  $hit = [W32]::WindowFromPoint($point)
  if ($hit -eq [IntPtr]::Zero) { throw "IDENTITY_POINT_OUTSIDE" }
  $root = [W32]::GetAncestor($hit, 2) # GA_ROOT; a child in A is still A
  if ($root -eq [IntPtr]::Zero) { throw "IDENTITY_POINT_OUTSIDE" }
  if (-not $popup) {
    if ($root -ne $h) { throw "IDENTITY_POINT_OUTSIDE" }
  } elseif (-not $afterDown -or $root -ne $h) {
    $targetPid = [uint32]0; $popupPid = [uint32]0
    $targetThread = [W32]::GetWindowThreadProcessId($h, [ref]$targetPid)
    $popupThread = [W32]::GetWindowThreadProcessId($root, [ref]$popupPid)
    if ([W32]::ClassName($root) -cne "#32768" -or $targetThread -eq 0 -or
        $popupThread -eq 0 -or $popupThread -ne $targetThread -or $popupPid -ne $targetPid -or
        [W32]::MenuOwner($targetThread) -ne $h) {
      throw "IDENTITY_POINT_OUTSIDE"
    }
  }
}
function ReleaseMouseOnTarget($step, [uint32]$up) {
  $key = if ($null -ne $step.window) { "label:$($step.window)" } else { "sole" }
  $token = $script:bindings[$key]
  if (-not $token) { throw "IDENTITY_MOUSE_RELEASE_FAILED" }
  [void](ValidateNative $token $false)
  $x = [int][math]::Floor(([int]$token.rect[0] + [int]$token.rect[2]) / 2)
  $y = [int][math]::Floor(([int]$token.rect[1] + [int]$token.rect[3]) / 2)
  if (-not [W32]::SetCursorPos($x, $y)) { throw "IDENTITY_MOUSE_RELEASE_FAILED" }
  $point = New-Object W32+POINT
  if (-not [W32]::GetCursorPos([ref]$point) -or $point.X -ne $x -or $point.Y -ne $y) { throw "IDENTITY_MOUSE_RELEASE_FAILED" }
  $hit = [W32]::WindowFromPoint($point)
  if ($hit -eq [IntPtr]::Zero -or [W32]::GetAncestor($hit, 2) -ne [IntPtr]([int64]::Parse($token.hwnd))) {
    throw "IDENTITY_MOUSE_RELEASE_FAILED"
  }
  [void](ValidateNative $token $false) # reject a closed/reused HWND even when its numeric handle matches
  [W32]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
}
function MouseClick($step, [uint32]$down, [uint32]$up, [int]$x, [int]$y, [bool]$popup) {
  MousePoint $step $x $y $popup # final observation after the wait and resolver, immediately before down
  $held = $true
  try {
    [W32]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    MousePoint $step $x $y $popup $true
    [W32]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    $held = $false
  } finally {
    if ($held) {
      try { ReleaseMouseOnTarget $step $up }
      catch { throw "IDENTITY_MOUSE_RELEASE_FAILED" }
    }
  }
}
function TargetHkl($step) {
  $el = Target $step $true
  $h = [IntPtr]$el.Current.NativeWindowHandle; $processId = [uint32]0
  $threadId = [W32]::GetWindowThreadProcessId($h, [ref]$processId)
  if ($threadId -eq 0 -or [int]$processId -ne [int]$el.Current.ProcessId) { throw "PHYSICAL_THREAD_MISMATCH" }
  $layout = [W32]::GetKeyboardLayout($threadId)
  if ($layout -eq [IntPtr]::Zero) { throw "PHYSICAL_HKL_MISSING" }
  $bindingKey = if ($null -ne $step.window) { "label:$($step.window)" } else { "sole" }
  [void](ValidateNative $script:bindings[$bindingKey] $true)
  return $layout.ToInt64().ToString("X16")
}
function PhysicalPlan($step, $actualHkl) {
  $target = Target $step $true
  $planArgs = @{ keys = @($step.keys); expectedHkl = $step.hkl; actualHkl = $actualHkl;
             targetHwnd = ([IntPtr]$target.Current.NativeWindowHandle).ToInt64().ToString();
             foregroundHwnd = ([W32]::GetForegroundWindow()).ToInt64().ToString() }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($planArgs | ConvertTo-Json -Compress -Depth 6)))
  $answer = & node "$PSScriptRoot\physical-chord.mjs" $encoded
  if ($LASTEXITCODE -ne 0 -or -not $answer) {
    $reason = try { ($answer | ConvertFrom-Json).error } catch { "PHYSICAL_PLAN_FAILED" }
    throw $reason
  }
  return ($answer | ConvertFrom-Json)
}
function FindByName($root, $name) {
  $c = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $name)
  $root.FindFirst($TS::Descendants, $c)
}
function Shot($el, $path, $screen) {
  if ($screen) { $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $x=$b.X; $y=$b.Y; $wd=$b.Width; $ht=$b.Height }
  else { $r = New-Object W32+RECT; [void][W32]::GetWindowRect([IntPtr]$el.Current.NativeWindowHandle, [ref]$r); $x=$r.L; $y=$r.T; $wd=$r.R-$r.L; $ht=$r.B-$r.T }
  $bmp = New-Object System.Drawing.Bitmap $wd, $ht; $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size); $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
function DumpMenu($m, $pre) {
  for ($i = 0; $i -lt [W32]::GetMenuItemCount($m); $i++) {
    $t = [W32]::Item($m, $i); $st = [W32]::GetMenuState($m, [uint32]$i, 0x400); $sub = [W32]::GetSubMenu($m, $i)
    if ($sub -ne [IntPtr]::Zero) { L ("$pre" + $t.Replace("&", "")); DumpMenu $sub ("$pre  "); continue }
    if ($st -band 0x800) { L "$pre----"; continue }
    $flag = if ($st -band 0x3) { " [disabled]" } elseif ($st -band 0x8) { " [checked]" } else { "" }
    L ("$pre" + $t.Replace("`t", " | ") + $flag)
  }
}
function Tree($el, $d, $pre) {
  if ($d -lt 0) { return }
  $kids = $el.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($k in $kids) { L ("$pre" + $k.Current.ControlType.ProgrammaticName.Replace("ControlType.","") + " '" + $k.Current.Name + "'"); if ($k.Current.ClassName -notmatch "Chrome") { try { Tree $k ($d-1) ("$pre  ") } catch { L "$pre  (skipped)" } } }
}
$failed = $false; $n = 0
foreach ($s in (Get-Content -Raw -Encoding UTF8 $Steps | ConvertFrom-Json)) {
  $n++
  try {
    if ($null -ne $s.window -and $s.op -in @("windows", "visible", "showall", "wait", "open", "run", "tree", "filedialog")) { throw "IDENTITY_UNSUPPORTED_OP" }
    switch ($s.op) {
      "windows" { foreach ($w in MdproWindows) { L ("window '" + $w.Current.Name + "' hwnd=" + $w.Current.NativeWindowHandle + " rect=" + $w.Current.BoundingRectangle) } }
      "focus"   { Focus (Target $s); [void](Target $s $true); L "focused" }
      "max"     { $m = Target $s; [void][W32]::ShowWindow([IntPtr]$m.Current.NativeWindowHandle, 3); Start-Sleep -Milliseconds 400; L "maximized" }
      "menuinfo" { $h = [IntPtr](Target $s).Current.NativeWindowHandle; $m = [W32]::GetMenu($h); L ("hwnd=" + $h + " hmenu=" + $m + " count=" + [W32]::GetMenuItemCount($m) + " lastErr=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
      "visible" { foreach ($w in MdproWindows) { L ("visible=" + [W32]::IsWindowVisible([IntPtr]$w.Current.NativeWindowHandle)) } }
      "showall" { foreach ($p in Get-Process tauri-app -ErrorAction SilentlyContinue) { foreach ($h in [W32]::Tops([uint32]$p.Id)) { if ([W32]::Title($h) -ne "mdpro") { continue }; $was = [W32]::IsWindowVisible($h); if (-not $was) { [void][W32]::ShowWindow($h, 5) }; L ("hwnd=" + $h + " wasVisible=" + $was + " nowVisible=" + [W32]::IsWindowVisible($h)) } } }
      "restore" { $m = Target $s; [void][W32]::ShowWindow([IntPtr]$m.Current.NativeWindowHandle, 9); L "restored" }
      "layout" { $targetEl = Target $s; $hkl = TargetHkl $s
                 L ("layout hwnd=" + $targetEl.Current.NativeWindowHandle + " hkl=" + $hkl) }
      "keys" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "chord"   {
        # Real key events via keybd_event: "ctrl+shift+n", "ctrl+4", "esc", "enter", "a" ...
        $vk = @{ ctrl=0x11; shift=0x10; alt=0x12; win=0x5B; enter=0x0D; esc=0x1B; tab=0x09; back=0x08; del=0x2E; up=0x26; down=0x28; left=0x25; right=0x27; home=0x24; end=0x23; space=0x20; pagedown=0x22; pageup=0x21;
                 slash=0xBF; comma=0xBC; minus=0xBD; equals=0xBB; backtick=0xC0; period=0xBE; semicolon=0xBA; lbracket=0xDB; rbracket=0xDD; backslash=0xDC; quote=0xDE }
        for ($f = 1; $f -le 12; $f++) { $vk["f$f"] = 0x6F + $f }
        if (-not $s.nofocus) { Focus (Target $s) }
        [void](Target $s $true)
        foreach ($c in @($s.keys)) {
          $parts = $c.ToLower().Split("+"); $codes = @()
          foreach ($p in $parts) { if ($vk.ContainsKey($p)) { $codes += $vk[$p] } elseif ($p -match '^[a-z0-9]$') { $codes += [int][char]$p.ToUpper() } else { throw "unknown key '$p' (use names: backtick slash minus equals period comma semicolon quote lbracket rbracket backslash f1-f12 ...)" } }
          $held = New-Object System.Collections.ArrayList
          try {
            foreach ($k in $codes) {
              [void](Target $s $true)
              [void]$held.Add($k)
              [W32]::keybd_event([byte]$k, 0, 0, [UIntPtr]::Zero)
              Start-Sleep -Milliseconds 30
            }
            [array]::Reverse($codes)
            foreach ($k in $codes) {
              [void](Target $s $true)
              [W32]::keybd_event([byte]$k, 0, 2, [UIntPtr]::Zero)
              $held.RemoveAt($held.Count - 1)
              Start-Sleep -Milliseconds 30
            }
          } finally {
            $releaseFailed = $false
            for ($i = $held.Count - 1; $i -ge 0; $i--) {
              try { [W32]::keybd_event([byte]$held[$i], 0, 2, [UIntPtr]::Zero) }
              catch { $releaseFailed = $true }
            }
            if ($releaseFailed) { throw "IDENTITY_LOGICAL_RELEASE_FAILED" }
          }
          Start-Sleep -Milliseconds 250; L ("chord " + $c)
        }
      }
      "physicalChord" {
        if ([IntPtr]::Size -ne 8) { throw "PHYSICAL_ARCH_UNSUPPORTED" }
        $targetEl = Target $s
        if (-not $s.nofocus) { Focus $targetEl }
        [void](Target $s $true)
        $actualHkl = TargetHkl $s
        $plan = PhysicalPlan $s $actualHkl
        $expectedHkl = ([string]$s.hkl).ToUpperInvariant()
        $held = New-Object System.Collections.ArrayList
        L ("physicalChord start hwnd=" + $targetEl.Current.NativeWindowHandle + " hkl=" + $actualHkl +
           " keys=" + ($s.keys -join ",") + " scans=" + (($plan.events | ForEach-Object { "$($_.scan):$($_.extended):$($_.up)" }) -join ","))
        try {
          foreach ($event in @($plan.events)) {
            [void](Target $s $true)
            if ((TargetHkl $s) -ne $expectedHkl) { throw "PHYSICAL_HKL_MISMATCH" }
            if (-not $event.up) { [void]$held.Add($event) }
            if ([W32]::SendScan([uint16]$event.scan, [bool]$event.up, [bool]$event.extended) -ne 1) {
              if (-not $event.up) { $held.RemoveAt($held.Count - 1) }
              throw "PHYSICAL_SEND_SHORT"
            }
            if ($event.up) {
              if ($held.Count -eq 0 -or $held[$held.Count - 1].name -ne $event.name) { throw "PHYSICAL_PLAN_INVALID" }
              $held.RemoveAt($held.Count - 1)
            }
            Start-Sleep -Milliseconds 30
          }
        } catch {
          if ($_.Exception.Message -match "IDENTITY_|PHYSICAL_") { throw }
          throw "PHYSICAL_DISPATCH_FAILED: $($_.Exception.Message)"
        } finally {
          $releaseFailed = $false
          for ($i = $held.Count - 1; $i -ge 0; $i--) {
            $pressed = $held[$i]
            try { if ([W32]::SendScan([uint16]$pressed.scan, $true, [bool]$pressed.extended) -ne 1) { $releaseFailed = $true } }
            catch { $releaseFailed = $true }
          }
          if ($releaseFailed) { throw "PHYSICAL_RELEASE_FAILED" }
        }
        L ("physicalChord success hwnd=" + $targetEl.Current.NativeWindowHandle + " hkl=" + $actualHkl)
      }
      "menus"   { $h = [IntPtr](Target $s).Current.NativeWindowHandle; DumpMenu ([W32]::GetMenu($h)) "" }
      "menu" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "click" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "settext" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "shot"    { $w = if ($s.screen) { $null } else { Target $s }; Shot $w $s.out $s.screen; L ("shot " + $s.out) }
      "wait"    { Start-Sleep -Milliseconds $s.ms }
      "filedialog" {
        # Common file dialog in the foreground: set the file-name box (AutomationId 1001 / 1148) and press Enter.
        if (@(MdproWindows).Count -ne 1) { throw "IDENTITY_DIALOG_AMBIGUOUS" }
        $fg = $AE::FromHandle([W32]::GetForegroundWindow()); L ("dialog '" + $fg.Current.Name + "'")
        $edits = $fg.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
        $ed = $edits | Where-Object { $_.Current.AutomationId -eq "1001" -or ($_.Current.Name -match "^(文件名|File name)") } | Select-Object -First 1
        if (-not $ed) { $ed = $fg.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, "Edit"))) | Select-Object -First 1 }
        if (-not $ed) { foreach ($e in $edits) { L ("edit name='" + $e.Current.Name + "' aid=" + $e.Current.AutomationId + " class=" + $e.Current.ClassName) }; throw "file name box not found" }
        $vp = $null; try { $vp = $ed.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
        if ($vp) { L ("name was '" + $vp.Current.Value + "'"); if ($s.path) { $vp.SetValue($s.path) } }
        elseif ($s.path) { [void][W32]::SendMessageW([IntPtr]$ed.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $s.path); L "set via WM_SETTEXT" }
        Start-Sleep -Milliseconds 200
        if ($s.cancel) { [W32]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero); [W32]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero); L "cancelled" }
        else { try { $ed.SetFocus() } catch {}; [W32]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero); [W32]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero); L ("entered " + $s.path) }
        Start-Sleep -Milliseconds 800
      }
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
      "open"    { $exe = if ($env:MDPRO_EXE) { $env:MDPRO_EXE } else { "D:\programs\mdpro\tauri-app.exe" }; Start-Process -FilePath $exe -ArgumentList ('"' + $s.path + '"'); Start-Sleep -Milliseconds 1500; L ("opened " + $s.path) }
      "run"     { Start-Process -FilePath $s.exe -ArgumentList $s.args; L ("ran " + $s.exe) }
      "tree"    { $fg = [W32]::GetForegroundWindow(); $el = $AE::FromHandle($fg); L ("fg '" + $el.Current.Name + "'"); Tree $el ([int]$s.depth) "  " }
    }
  } catch {
    L ("ERROR " + $s.op + ": " + $_.Exception.Message)
    if ($_.Exception.Message -match "IDENTITY_|PHYSICAL_" -or $s.onError -ne "continue") { $failed = $true; L ("ABORTED at step " + $n); break }
  }
}
foreach ($label in @($script:markers.Keys)) {
  $nonce = $script:markers[$label].nonce
  $request = @{ nonce = $nonce } | ConvertTo-Json -Compress
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($request))
  $restored = & node "$PSScriptRoot\cdp.mjs" --window $label unbind $b64
  if ($LASTEXITCODE -ne 0 -or -not $restored) { L "ERROR identity restore: IDENTITY_TITLE_RESTORE_FAILED label=$label"; $failed = $true }
}
$log | ConvertTo-Json | Set-Content -Encoding UTF8 $Out
if ($failed) { exit 1 }
