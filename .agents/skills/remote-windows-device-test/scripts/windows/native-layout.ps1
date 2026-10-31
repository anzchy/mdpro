# Purpose: keyboard-layout activation, readback and per-event HKL checks on the verified input context (D338).
# The input context is the bound owner's focused input window (GetGUIThreadInfo) and its thread, never
# the driver's thread and never the owner's outer thread by assumption. Contracts: ../../reference/ops.md.
# An activated input window is pinned with a driver property (K4): every later read of that context
# needs the same window carrying the same pin, so a child re-created under the same HWND is refused.
$script:layoutPins = @{}
# One baseline per context (binding key), in first-activation order: its first prior HKL, its pin and
# its own `pending` flag. A revisit never replaces it (K5, K7).
$script:layoutBaselines = New-Object System.Collections.ArrayList
function LayoutKey($step) { if ($null -ne $step.window) { "label:$($step.window)" } else { "sole" } }
function Assert-InputPin($pin) {
  if ([W32]::GetProp([IntPtr]([int64]$pin.input), $pin.key).ToInt64().ToString() -cne $pin.value) { throw ("LAYOUT_INPUT_REPLACED input=" + $pin.input) }
}
function Remove-InputPins {
  foreach ($pin in @($script:layoutPins.Values)) {
    $h = [IntPtr]([int64]$pin.input)
    if ([W32]::GetProp($h, $pin.key).ToInt64().ToString() -ceq $pin.value) { [void][W32]::RemoveProp($h, $pin.key) }
  }
  $script:layoutPins = @{}
}
function Get-InputContext($step) {
  $owner = Target $step $true
  $h = [IntPtr]$owner.Current.NativeWindowHandle; $ownerPid = [uint32]0
  $outer = [W32]::GetWindowThreadProcessId($h, [ref]$ownerPid)
  if ($outer -eq 0 -or [int]$ownerPid -ne [int]$owner.Current.ProcessId) { throw "PHYSICAL_THREAD_MISMATCH" }
  $focus = [W32]::FocusWindow($outer); $focusPid = [uint32]0
  if ($focus -eq [IntPtr]::Zero) { throw ("LAYOUT_INPUT_UNREADABLE owner=" + $h.ToInt64()) }
  # A WebView input child may belong to another process; it must still be inside the owner.
  if ([W32]::GetAncestor($focus, 2) -ne $h) { throw ("LAYOUT_INPUT_OUTSIDE input=" + $focus.ToInt64() + " owner=" + $h.ToInt64()) }
  $thread = [W32]::GetWindowThreadProcessId($focus, [ref]$focusPid)
  if ($thread -eq 0) { throw ("LAYOUT_INPUT_UNREADABLE input=" + $focus.ToInt64()) }
  $pin = $script:layoutPins[(LayoutKey $step)]
  if ($null -ne $pin) {
    if ($focus.ToInt64().ToString() -ne $pin.input) { throw ("LAYOUT_INPUT_CHANGED input=" + $focus.ToInt64() + " pinned=" + $pin.input) }
    Assert-InputPin $pin
  }
  return @{ owner = $h.ToInt64().ToString(); input = $focus.ToInt64().ToString(); thread = [uint32]$thread }
}
function TargetHkl($step) {
  $ctx = Get-InputContext $step
  $layout = [W32]::GetKeyboardLayout($ctx.thread)
  if ($layout -eq [IntPtr]::Zero) { throw "PHYSICAL_HKL_MISSING" }
  $bindingKey = if ($null -ne $step.window) { "label:$($step.window)" } else { "sole" }
  [void](ValidateNative $script:bindings[$bindingKey] $true)
  $script:lastInput = $ctx
  return $layout.ToInt64().ToString("X16")
}
function Read-Layout($step) {
  $hkl = TargetHkl $step; $ctx = $script:lastInput
  L ("layout hwnd=" + $ctx.owner + " input=" + $ctx.input + " thread=" + $ctx.thread + " hkl=" + $hkl)
}
# A KLID is eight hex digits; nothing native happens for any other value. LoadKeyboardLayout runs
# without KLF_ACTIVATE and its return is not proof: it may substitute a default layout or load one
# that was never installed, so the result must carry the KLID's language and be in the list taken
# before the load. A layout this check loaded itself is unloaded again.
function Resolve-Layout([string]$klid) {
  $installed = @([W32]::LayoutList() | ForEach-Object { $_.ToInt64() })
  $loaded = [W32]::LoadKeyboardLayout($klid, 0).ToInt64()
  if ($loaded -ne 0 -and ($loaded -band 0xFFFF) -eq ([Convert]::ToInt64($klid, 16) -band 0xFFFF) -and $installed -contains $loaded) { return $loaded }
  if ($loaded -ne 0 -and $installed -notcontains $loaded) { [void][W32]::UnloadKeyboardLayout([IntPtr]$loaded) }
  throw ("LAYOUT_UNAVAILABLE requested=" + $klid + " loaded=" + $loaded.ToString("X16"))
}
function Invoke-SetLayout($step) {
  if ($step.klid -isnot [string] -or $step.klid -cnotmatch '^[0-9A-Fa-f]{8}$') { throw "LAYOUT_KLID_INVALID" }
  $klid = $step.klid.ToUpperInvariant()
  $ctx = Get-InputContext $step
  $before = [W32]::GetKeyboardLayout($ctx.thread).ToInt64()
  if ($before -eq 0) { throw ("LAYOUT_HKL_UNREADABLE input=" + $ctx.input + " thread=" + $ctx.thread) }
  $loaded = Resolve-Layout $klid
  if ($null -eq $script:layoutPins[(LayoutKey $step)]) {
    $pin = @{ input = $ctx.input; key = ("mdpro-layout-" + [guid]::NewGuid().ToString("N")); value = [string](Get-Random -Minimum 1 -Maximum 2147483647) }
    if (-not [W32]::SetProp([IntPtr]([int64]$pin.input), $pin.key, [IntPtr]([int64]$pin.value))) { throw ("LAYOUT_INPUT_PIN_FAILED input=" + $pin.input) }
    $script:layoutPins[(LayoutKey $step)] = $pin
  }
  $baseline = @($script:layoutBaselines | Where-Object { $_.bindingKey -ceq (LayoutKey $step) })[0]
  if ($null -eq $baseline) {
    $baseline = @{ ctx = $ctx; prior = $before; bindingKey = (LayoutKey $step); pin = $script:layoutPins[(LayoutKey $step)]; pending = $false }
    [void]$script:layoutBaselines.Add($baseline)
  }
  $observed = $before
  $values = { "requested=" + $klid + " loaded=" + $loaded.ToString("X16") + " before=" + $before.ToString("X16") + " observed=" + $observed.ToString("X16") }
  if ($before -ne $loaded) {
    # The request is posted and the window may refuse it: only the input thread's own HKL counts.
    if (-not [W32]::PostMessage([IntPtr]([int64]$ctx.input), 0x50, [IntPtr]::Zero, [IntPtr]$loaded)) { throw ("LAYOUT_REQUEST_REJECTED " + (& $values)) }
    Start-Phase "layout-activate"
    $limit = [math]::Min($script:phaseStartedMs + $PhaseMs, $script:workDeadline)
    while ($observed -ne $loaded) {
      if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $limit) {
        # The thread never left its prior HKL: the request may still be queued and apply later.
        if ($observed -eq $before) { $baseline.pending = $true }
        throw ("LAYOUT_NOT_OBSERVED " + (& $values) + " input=" + $ctx.input + " thread=" + $ctx.thread)
      }
      [Threading.Thread]::Sleep(50)
      $observed = [W32]::GetKeyboardLayout((Get-InputContext $step).thread).ToInt64()
    }
  }
  L ("setLayout requested=" + $klid + " loaded=" + $loaded.ToString("X16") + " before=" + $before.ToString("X16") +
     " observed=" + $observed.ToString("X16") + " owner=" + $ctx.owner + " input=" + $ctx.input + " thread=" + $ctx.thread)
}
# Cleanup: every context changed in the run is restored, in reverse order of first activation, and a
# failure on one never skips another. Never throws: it returns every failure, joined, for ui.ps1 to
# report after title restore and unpinning have still run; its own input pins are removed either way.
function Restore-Layouts {
  $failures = @()
  try {
    for ($i = $script:layoutBaselines.Count - 1; $i -ge 0; $i--) {
      $failure = Restore-Baseline $script:layoutBaselines[$i]
      if ($failure) { $failures += $failure }
    }
  } finally { Remove-InputPins }
  if ($failures.Count -gt 0) { return ($failures -join "; ") }
  return $null
}
# One context: post its first captured prior HKL back to its input window and claim restoration only
# when two independent reads of its input thread, a settle wait apart, equal it. A replaced input
# window gets no restore request, and a request still pending from a timed-out activation of this
# context makes the result LAYOUT_RESTORE_UNCERTAIN, never restored.
function Restore-Baseline($b) {
  $ctx = $b.ctx; $prior = [int64]$b.prior; $observed = $null
  $fail = { param($code = "LAYOUT_RESTORE_FAILED") $code + " input=" + $ctx.input + " thread=" + $ctx.thread + " prior=" + $prior.ToString("X16") +
            " observed=" + $(if ($null -eq $observed) { "unknown" } else { $observed.ToString("X16") }) }
  try {
    Start-Phase "layout-restore" -Cleanup
    [void](ValidateNative $script:bindings[$b.bindingKey] $false)
    Assert-InputPin $b.pin
    $observed = [W32]::GetKeyboardLayout($ctx.thread).ToInt64()
    if ($observed -ne $prior -and -not [W32]::PostMessage([IntPtr]([int64]$ctx.input), 0x50, [IntPtr]::Zero, [IntPtr]$prior)) {
      return ((& $fail) + " reason=rejected")
    }
    $limit = [math]::Min($script:phaseStartedMs + $PhaseMs, $DeadlineMs)
    while ($true) {
      if ($observed -eq $prior) {
        [Threading.Thread]::Sleep(100); $observed = [W32]::GetKeyboardLayout($ctx.thread).ToInt64()
        if ($observed -eq $prior) { break }
      }
      if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $limit) { return ((& $fail) + " reason=not-observed") }
      [Threading.Thread]::Sleep(50); $observed = [W32]::GetKeyboardLayout($ctx.thread).ToInt64()
    }
    if ($b.pending) { return ((& $fail "LAYOUT_RESTORE_UNCERTAIN") + " reason=request-pending") }
    L ("layout-restore input=" + $ctx.input + " thread=" + $ctx.thread + " prior=" + $prior.ToString("X16") + " observed=" + $observed.ToString("X16") + " restored")
    Complete-Phase
    return $null
  } catch { return ((& $fail) + " reason=" + $_.Exception.Message) }
}
