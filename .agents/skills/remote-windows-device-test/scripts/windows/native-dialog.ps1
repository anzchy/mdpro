# Purpose: owner-bound common file dialog (D336). The dialog is chosen by dialog-binding.mjs from
# native observations of the verified owner's process: owner chain, process lifetime, executable,
# the common-dialog class and one filename Edit. Title, foreground and order never select it;
# foreground is only the final safety check before text and keys, made after the journal write. The resolved dialog and control
# are pinned to their window lifetime by an unpredictable window property, as the owner is, so a
# same-HWND successor never inherits the authorization. Contract: ../../reference/ops.md.
$script:dialogChainLimit = 32
$script:dialogPins = @()
function DialogObservations($token) {
  $ownerPid = [uint32]$token.pid
  $process = Get-Process -Id $ownerPid -ErrorAction Stop
  $birth = $process.StartTime.ToUniversalTime().Ticks.ToString(); $exe = [string]$process.Path
  foreach ($h in [W32]::AllTops($ownerPid)) {
    $chain = @(); $next = [W32]::GetWindow($h, 4) # GW_OWNER
    while ($next -ne [IntPtr]::Zero -and $chain.Count -lt $script:dialogChainLimit) { $chain += $next.ToInt64().ToString(); $next = [W32]::GetWindow($next, 4) }
    $controls = @(foreach ($c in [W32]::Children($h)) {
      $parent = [W32]::GetParent($c)
      @{ hwnd = $c.ToInt64().ToString(); className = [W32]::ClassName($c); ctrlId = [W32]::GetDlgCtrlID($c);
         parentCtrlId = $(if ($parent -eq $h -or $parent -eq [IntPtr]::Zero) { 0 } else { [W32]::GetDlgCtrlID($parent) });
         visible = [W32]::IsWindowVisible($c) }
    })
    @{ hwnd = $h.ToInt64().ToString(); pid = [int]$ownerPid; birth = $birth; exe = $exe; className = [W32]::ClassName($h);
       visible = [W32]::IsWindowVisible($h); ownerChain = $chain; chainComplete = ($next -eq [IntPtr]::Zero); controls = $controls }
  }
}
# The owner is the run's own binding, or the owner a consumed receipt stored (native-dialog-receipt.ps1).
function DialogOwnerKey($s) { if ($null -ne $s.receipt) { "receipt" } elseif ($null -ne $s.window) { "label:$($s.window)" } else { "sole" } }
function Resolve-OwnedDialog($s) {
  $key = DialogOwnerKey $s
  # Native revalidation of the owner; no foreground requirement. A receipt owner never reaches CDP.
  if ($key -ceq "receipt") { [void](ValidateNative $script:bindings[$key] $false) } else { [void](Target $s) }
  $token = $script:bindings[$key]
  Start-Phase "dialog-discovery"
  $request = @{ owner = @{ hwnd = [string]$token.hwnd; pid = [int]$token.pid; birth = [string]$token.birth };
                expectedExe = $script:mdproExe; windows = @(DialogObservations $token) }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($request | ConvertTo-Json -Compress -Depth 8)))
  $answer = Invoke-NodeBounded "dialog-resolver" @("$PSScriptRoot\dialog-binding.mjs", $encoded) -AllowFailure
  $value = try { $answer | ConvertFrom-Json } catch { $null }
  if ($LASTEXITCODE -ne 0 -or -not $value -or $value.error) { throw ("IDENTITY_" + $(if ($value.error) { $value.error } else { "DIALOG_RESOLVER_FAILED" })) }
  return $value
}
function Pin-DialogLifetime($dialog) {
  foreach ($h in @($dialog.dialogHwnd, $dialog.controlHwnd)) {
    $pin = @{ hwnd = [IntPtr]([int64]$h); key = "mdpro-dialog-" + [guid]::NewGuid().ToString("N");
              value = [string](Get-Random -Minimum 1 -Maximum 2147483647) }
    $script:dialogPins += ,$pin
    if (-not [W32]::SetProp($pin.hwnd, $pin.key, [IntPtr]([int64]$pin.value))) { throw "IDENTITY_DIALOG_PIN_FAILED" }
  }
}
function Test-DialogPin($pin) { return [W32]::GetProp($pin.hwnd, $pin.key).ToInt64().ToString() -ceq $pin.value }
function Assert-DialogLifetime { foreach ($pin in $script:dialogPins) { if (-not (Test-DialogPin $pin)) { throw "IDENTITY_DIALOG_LIFETIME" } } }
# Removes only this run's pins from windows that still carry them; never throws, so it cannot hide
# an earlier error. A pin that cannot be removed is logged and reported by the caller.
function Clear-DialogPins {
  $ok = $true
  foreach ($pin in $script:dialogPins) {
    try {
      if ((Test-DialogPin $pin) -and [W32]::RemoveProp($pin.hwnd, $pin.key).ToInt64().ToString() -cne $pin.value) { $ok = $false }
    } catch { $ok = $false }
  }
  $script:dialogPins = @()
  if (-not $ok) { L "dialog unpin failed" }
  return $ok
}
function Assert-DialogForeground($dialog) {
  if ([W32]::GetForegroundWindow().ToInt64().ToString() -cne [string]$dialog.dialogHwnd) { throw "IDENTITY_DIALOG_FOREGROUND" }
}
# The key is durable before the final foreground and pin checks, and nothing between them and the
# key touches the disk (fix 1, MH1); a refused key is withdrawn, never sent.
function Send-DialogKey([byte]$Key, $dialog) {
  $mark = Begin-Input
  try { Assert-DialogForeground $dialog; Assert-DialogLifetime } catch { Withdraw-Input $mark; throw }
  $held = $true
  try {
    [W32]::keybd_event($Key, 0, 0, [UIntPtr]::Zero)
    [W32]::keybd_event($Key, 0, 2, [UIntPtr]::Zero); $held = $false; Set-HeldInput -1
  } finally {
    if ($held) {
      try { [W32]::keybd_event($Key, 0, 2, [UIntPtr]::Zero); Set-HeldInput -1 }
      catch { $script:releaseUncertain = $true; throw "IDENTITY_DIALOG_RELEASE_FAILED" }
    }
  }
}
# Enter or Esc reached the dialog; only the end of its pinned lifetime (hidden, or destroyed even
# if a successor took the HWND) within the phase proves it was accepted.
function Wait-DialogDismissed($dialog) {
  Start-Phase "dialog-dismissal"
  $h = [IntPtr]([int64]$dialog.dialogHwnd); $pin = $script:dialogPins[0]
  $limit = [math]::Min($script:phaseStartedMs + $PhaseMs, $script:workDeadline)
  while ([W32]::IsWindowVisible($h) -and (Test-DialogPin $pin)) {
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $limit) { throw "UI_DIALOG_NOT_DISMISSED" }
    [Threading.Thread]::Sleep(25)
  }
  Complete-Phase
  L "dialog dismissed"
}
# An absolute drive or UNC path of 1-259 UTF-16 code units ([string].Length), no control character.
function Test-DialogPath($Path) {
  if ($Path -isnot [string] -or $Path.Length -lt 1 -or $Path.Length -gt 259 -or $Path -match '[\x00-\x1F\x7F]') { return $false }
  return ($Path -match '^[A-Za-z]:\\' -or $Path -match '^\\\\[^\\]+\\[^\\]+')
}
function Invoke-FileDialog($s) {
  # Cancel ignores any supplied path and never writes; it still needs A's unique dialog.
  if (-not $s.cancel -and -not (Test-DialogPath $s.path)) { throw "UI_DIALOG_PATH_INVALID" }
  if ($null -ne $s.receipt) { Use-DialogReceipt $s }
  $dialog = Resolve-OwnedDialog $s
  L ("dialog owner=" + $script:bindings[(DialogOwnerKey $s)].hwnd +
     " dialog=" + $dialog.dialogHwnd + " control=" + $dialog.controlHwnd + " depth=" + $dialog.depth)
  $script:dialogPins = @()
  try {
    Pin-DialogLifetime $dialog
    Assert-DialogForeground $dialog
    Assert-DialogLifetime
    if ($s.cancel) {
      Start-Phase "input:dialog-cancel"
      Send-DialogKey 0x1B $dialog
      L "dialog cancelled"
      Wait-DialogDismissed $dialog
    } else {
      Start-Phase "input:dialog-path"
      $control = [IntPtr]([int64]$dialog.controlHwnd)
      $mark = Begin-Input -Touch
      try { Assert-DialogForeground $dialog; Assert-DialogLifetime } catch { Withdraw-Input $mark -Touch; throw }
      $written = [W32]::SendMessageW($control, 0x000C, [IntPtr]::Zero, [string]$s.path) # WM_SETTEXT
      # The Edit must take the text and hold exactly it, or Enter would submit a name never written (gpt M1).
      if ($written -eq [IntPtr]::Zero) { throw "UI_DIALOG_WRITE_REJECTED" }
      if ([W32]::ControlText($control) -cne [string]$s.path) { throw "UI_DIALOG_WRITE_MISMATCH" }
      L "dialog path set"
      $again = Resolve-OwnedDialog $s
      if ($again.dialogHwnd -cne $dialog.dialogHwnd -or $again.controlHwnd -cne $dialog.controlHwnd) { throw "IDENTITY_DIALOG_CHANGED" }
      Start-Phase "input:dialog-submit"
      Send-DialogKey 0x0D $again
      L ("dialog submitted " + $s.path)
      Wait-DialogDismissed $dialog
    }
  } finally { $unpinned = Clear-DialogPins }
  if (-not $unpinned) { throw "IDENTITY_DIALOG_UNPIN_FAILED" }
}
