# Purpose: read-only UIA, screenshots and menu inspection for the native dispatcher.
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
