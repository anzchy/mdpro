# Purpose: drive mdpro's native window from the user's interactive desktop session
# (SSH has no desktop). Reads a JSON step list, runs each step, writes a JSON log.
# Run it through ui-run.ps1 (Mac side: scripts/mac/ui.sh), never directly over SSH.
# Steps: see ../../reference/ops.md (kept in sync with this file). Every step logs one line; an
# error logs "ERROR <op>: ..." and the run continues with the next step.
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
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetMenuItemRect(IntPtr h, IntPtr m, uint i, out RECT r);
  public static string Item(IntPtr m, int i) { var sb = new System.Text.StringBuilder(256); GetMenuString(m, (uint)i, sb, 256, 0x400); return sb.ToString(); }
  public struct RECT { public int L, T, R, B; }
}
"@
[void][W32]::SetProcessDPIAware()
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$log = New-Object System.Collections.ArrayList
function L($o) { [void]$log.Add($o) }
function MdproWindows {
  $ids = @(Get-Process tauri-app -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
  $AE::RootElement.FindAll($TS::Children, $c) | Where-Object { $ids -contains $_.Current.ProcessId }
}
function MainWin { $w = @(MdproWindows); if ($w.Count -eq 0) { throw "no mdpro window" }; $fg = [W32]::GetForegroundWindow(); $hit = $w | Where-Object { [IntPtr]$_.Current.NativeWindowHandle -eq $fg }; if ($hit) { $hit } else { $w[0] } }
function Focus($el) {
  $h = [IntPtr]$el.Current.NativeWindowHandle
  [W32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) # Alt tap unlocks SetForegroundWindow
  [void][W32]::SetForegroundWindow($h); Start-Sleep -Milliseconds 250
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
foreach ($s in (Get-Content -Raw -Encoding UTF8 $Steps | ConvertFrom-Json)) {
  try {
    switch ($s.op) {
      "windows" { foreach ($w in MdproWindows) { L ("window '" + $w.Current.Name + "' hwnd=" + $w.Current.NativeWindowHandle + " rect=" + $w.Current.BoundingRectangle) } }
      "focus"   { Focus (MainWin); L "focused" }
      "max"     { $m = MainWin; [void][W32]::ShowWindow([IntPtr]$m.Current.NativeWindowHandle, 3); Start-Sleep -Milliseconds 400; L "maximized" }
      "menuinfo" { $h = [IntPtr](MainWin).Current.NativeWindowHandle; $m = [W32]::GetMenu($h); L ("hwnd=" + $h + " hmenu=" + $m + " count=" + [W32]::GetMenuItemCount($m) + " lastErr=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
      "visible" { foreach ($w in MdproWindows) { L ("visible=" + [W32]::IsWindowVisible([IntPtr]$w.Current.NativeWindowHandle)) } }
      "showall" { foreach ($p in Get-Process tauri-app -ErrorAction SilentlyContinue) { foreach ($h in [W32]::Tops([uint32]$p.Id)) { if ([W32]::Title($h) -ne "mdpro") { continue }; $was = [W32]::IsWindowVisible($h); if (-not $was) { [void][W32]::ShowWindow($h, 5) }; L ("hwnd=" + $h + " wasVisible=" + $was + " nowVisible=" + [W32]::IsWindowVisible($h)) } } }
      "restore" { $m = MainWin; [void][W32]::ShowWindow([IntPtr]$m.Current.NativeWindowHandle, 9); L "restored" }
      "keys" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "chord"   {
        # Real key events via keybd_event: "ctrl+shift+n", "ctrl+4", "esc", "enter", "a" ...
        $vk = @{ ctrl=0x11; shift=0x10; alt=0x12; win=0x5B; enter=0x0D; esc=0x1B; tab=0x09; back=0x08; del=0x2E; up=0x26; down=0x28; left=0x25; right=0x27; home=0x24; end=0x23; space=0x20; pagedown=0x22; pageup=0x21;
                 slash=0xBF; comma=0xBC; minus=0xBD; equals=0xBB; backtick=0xC0; period=0xBE; semicolon=0xBA; lbracket=0xDB; rbracket=0xDD; backslash=0xDC; quote=0xDE }
        for ($f = 1; $f -le 12; $f++) { $vk["f$f"] = 0x6F + $f }
        if (-not $s.nofocus) { Focus (MainWin) }
        foreach ($c in @($s.keys)) {
          $parts = $c.ToLower().Split("+"); $codes = @()
          foreach ($p in $parts) { if ($vk.ContainsKey($p)) { $codes += $vk[$p] } elseif ($p -match '^[a-z0-9]$') { $codes += [int][char]$p.ToUpper() } else { throw "unknown key '$p' (use names: backtick slash minus equals period comma semicolon quote lbracket rbracket backslash f1-f12 ...)" } }
          foreach ($k in $codes) { [W32]::keybd_event([byte]$k, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
          [array]::Reverse($codes); foreach ($k in $codes) { [W32]::keybd_event([byte]$k, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
          Start-Sleep -Milliseconds 250; L ("chord " + $c)
        }
      }
      "menus"   { $h = [IntPtr](MainWin).Current.NativeWindowHandle; DumpMenu ([W32]::GetMenu($h)) "" }
      "menu" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "click" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "settext" { throw "unsupported: see reference/ops.md (never reached mdpro on 2026-10-12)" }
      "shot"    { $w = if ($s.screen) { $null } else { MainWin }; Shot $w $s.out $s.screen; L ("shot " + $s.out) }
      "wait"    { Start-Sleep -Milliseconds $s.ms }
      "filedialog" {
        # Common file dialog in the foreground: set the file-name box (AutomationId 1001 / 1148) and press Enter.
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
      "clickat" { [void][W32]::SetCursorPos([int]$s.x, [int]$s.y); Start-Sleep -Milliseconds 120; $f = if ($s.right) { 0x8, 0x10 } else { 0x2, 0x4 }
                  [W32]::mouse_event($f[0], 0, 0, 0, [UIntPtr]::Zero); [W32]::mouse_event($f[1], 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 300; L ("clickat " + $s.x + "," + $s.y) }
      "menuat"  {
        # Open a menu by its bar position and click an item, in ONE run (coordinates from a screen shot).
        Focus (MainWin)
        foreach ($pt in @($s.bar, $s.item)) { [void][W32]::SetCursorPos([int]$pt[0], [int]$pt[1]); Start-Sleep -Milliseconds 150
          [W32]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero); [W32]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 500 }
        L ("menuat bar=" + ($s.bar -join ",") + " item=" + ($s.item -join ","))
      }
      "menuclick" {
        # Real mouse clicks on the native menu: the top-level item, then the item in the dropdown.
        $h = [IntPtr](MainWin).Current.NativeWindowHandle; Focus (MainWin); $bar = [W32]::GetMenu($h); $m = $bar; $r = New-Object W32+RECT
        for ($k = 0; $k -lt $s.path.Count; $k++) {
          $name = $s.path[$k]; $hit = -1
          for ($i = 0; $i -lt [W32]::GetMenuItemCount($m); $i++) { if (((([W32]::Item($m, $i)) -split "`t")[0].Replace("&", "")) -eq $name) { $hit = $i; break } }
          if ($hit -lt 0) { throw "menu item not found: $name" }
          $owner = if ($k -eq 0) { $h } else { [IntPtr]::Zero }
          [void][W32]::GetMenuItemRect($owner, $m, [uint32]$hit, [ref]$r)
          $x = [int](($r.L + $r.R) / 2); $y = [int](($r.T + $r.B) / 2)
          [void][W32]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 150
          [W32]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero); [W32]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 450
          L ("click '$name' at $x,$y")
          $sub = [W32]::GetSubMenu($m, $hit); if ($sub -ne [IntPtr]::Zero) { $m = $sub }
        }
      }
      "open"    { $exe = if ($env:MDPRO_EXE) { $env:MDPRO_EXE } else { "D:\programs\mdpro\tauri-app.exe" }; Start-Process -FilePath $exe -ArgumentList ('"' + $s.path + '"'); Start-Sleep -Milliseconds 1500; L ("opened " + $s.path) }
      "run"     { Start-Process -FilePath $s.exe -ArgumentList $s.args; L ("ran " + $s.exe) }
      "tree"    { $fg = [W32]::GetForegroundWindow(); $el = $AE::FromHandle($fg); L ("fg '" + $el.Current.Name + "'"); Tree $el ([int]$s.depth) "  " }
    }
  } catch { L ("ERROR " + $s.op + ": " + $_.Exception.Message) }
}
$log | ConvertTo-Json | Set-Content -Encoding UTF8 $Out
