# Purpose: first real page/nonce resolver binding, then native lifetime checks before every event.
function MdproWindows {
  $ids = @(Get-Process tauri-app -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $script:mdproExe } | ForEach-Object { $_.Id })
  $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
  Start-Phase "uia-discovery"
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
  if ($token.birth -and $p.StartTime.ToUniversalTime().Ticks.ToString() -cne $token.birth) { throw "IDENTITY_PROCESS_LIFETIME" }
  if ($token.nativeKey -and [W32]::GetProp($h, $token.nativeKey).ToInt64().ToString() -cne $token.nativeValue) { throw "IDENTITY_WINDOW_LIFETIME" }
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
  Check-Deadline
  $cachedKey = if ($null -ne $label) { "label:$label" } else { "sole" }
  if ($script:bindings.ContainsKey($cachedKey)) {
    $cached = $script:bindings[$cachedKey]
    [void](ValidateNative $cached $foreground)
    return [pscustomobject]@{ Current = [pscustomobject]@{ NativeWindowHandle = [int64]$cached.hwnd; ProcessId = [int]$cached.pid } }
  }
  if ($null -ne $label -and $null -eq $step._identity) { throw "IDENTITY_READ_MISSING" }
  if ($null -ne $label -and -not $script:markers.ContainsKey($label)) {
    $record = @($step._identity | Where-Object { $_.label -ceq $label })
    if ($record.Count -ne 1) { throw "IDENTITY_LABEL_NOT_UNIQUE" }
    $nonce = [guid]::NewGuid().ToString("N")
    $script:markers[$label] = @{ nonce = $nonce; challenge = $null }
    if (-not $record[0].pageId) { throw "IDENTITY_PAGE_ID_MISSING" }
    $request = @{ rect = @($record[0].rect); pageId = [string]$record[0].pageId; nonce = $nonce } | ConvertTo-Json -Compress -Depth 5
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($request))
    $marked = Invoke-NodeBounded "title-bind" @("$PSScriptRoot\cdp.mjs", "--window", $label, "bind", $b64)
    if ($LASTEXITCODE -ne 0 -or -not $marked) { throw "IDENTITY_TITLE_BIND_FAILED" }
    $mark = $marked | ConvertFrom-Json
    if ($mark.label -cne $label -or -not $mark.challenge) { throw "IDENTITY_TITLE_BIND_INVALID" }
    $script:markers[$label].challenge = [string]$mark.challenge
  }
  $windows = @()
  Start-Phase "discovery"
  # An owned window (a file dialog, a popup) is never a candidate: only unowned top-levels are
  # mdpro windows, so an open dialog cannot make the sole route ambiguous or bind itself (D336).
  $elements = @(MdproWindows | Where-Object { [W32]::GetWindow([IntPtr]$_.Current.NativeWindowHandle, 4) -eq [IntPtr]::Zero })
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
  $answer = Invoke-NodeBounded "window-resolver" @("$PSScriptRoot\window-binding.mjs", $encoded)
  if ($LASTEXITCODE -ne 0 -or -not $answer) { throw "IDENTITY_REJECTED" }
  $token = $answer | ConvertFrom-Json
  $hit = @($elements | Where-Object { [string]$_.Current.NativeWindowHandle -eq $token.hwnd -and [int]$_.Current.ProcessId -eq $token.pid })
  if ($hit.Count -ne 1) { throw "IDENTITY_ELEMENT_STALE" }
  $token | Add-Member -NotePropertyName challenge -NotePropertyValue $bindingArgs.challenge -Force
  $process = Get-Process -Id $token.pid -ErrorAction Stop
  $token | Add-Member -NotePropertyName birth -NotePropertyValue $process.StartTime.ToUniversalTime().Ticks.ToString() -Force
  $token | Add-Member -NotePropertyName nativeKey -NotePropertyValue ("mdpro-driver-" + [guid]::NewGuid().ToString("N")) -Force
  $token | Add-Member -NotePropertyName nativeValue -NotePropertyValue ([string](Get-Random -Minimum 1 -Maximum 2147483647)) -Force
  if (-not [W32]::SetProp([IntPtr]([int64]$token.hwnd), $token.nativeKey, [IntPtr]([int64]$token.nativeValue))) { throw "IDENTITY_WINDOW_PIN_FAILED" }
  # Record ownership before the next native observation can reject this window.
  $alreadyBound = $script:bindings.ContainsKey($key)
  $script:bindings[$key] = $token
  [void](ValidateNative $token $foreground)
  if (-not $alreadyBound) {
    L ("bound label=" + $token.label + " hwnd=" + $token.hwnd + " pid=" + $token.pid +
       " rect=" + ($token.rect -join ",") + " foreground=" + $bindingArgs.foreground)
  }
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
  MousePoint $step $x $y $popup # observation after the wait and resolver
  Start-Phase "input:mouse-click"
  # The press is durable before the final pin, foreground, cursor and hit check; no file I/O between
  # that check and the down (fix 1, MH1). A refused press is withdrawn, never sent.
  $mark = Begin-Input
  try { MousePoint $step $x $y $popup } catch { Withdraw-Input $mark; throw }
  $held = $true
  try {
    [W32]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    MousePoint $step $x $y $popup $true
    [W32]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    $held = $false
    Set-HeldInput -1
  } finally {
    if ($held) {
      try { ReleaseMouseOnTarget $step $up; Set-HeldInput -1 }
      catch { $script:releaseUncertain = $true; throw "IDENTITY_MOUSE_RELEASE_FAILED" }
    }
  }
}
