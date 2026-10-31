# Purpose: logical and real physical dispatch with native-only per-event validation and reverse release.
# Each press is journalled before its final checks, so no file I/O separates check and event.
# TargetHkl (the input-thread HKL read before every physical event) lives in native-layout.ps1.
. "$PSScriptRoot\native-layout.ps1"
function PhysicalPlan($step, $actualHkl) {
  $target = Target $step $true
  $planArgs = @{ keys = @($step.keys); expectedHkl = $step.hkl; actualHkl = $actualHkl;
             targetHwnd = ([IntPtr]$target.Current.NativeWindowHandle).ToInt64().ToString();
             foregroundHwnd = ([W32]::GetForegroundWindow()).ToInt64().ToString() }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($planArgs | ConvertTo-Json -Compress -Depth 6)))
  $answer = Invoke-NodeBounded "physical-plan" @("$PSScriptRoot\physical-chord.mjs", $encoded) -AllowFailure
  if ($LASTEXITCODE -ne 0 -or -not $answer) {
    $reason = try { ($answer | ConvertFrom-Json).error } catch { "PHYSICAL_PLAN_FAILED" }
    throw $reason
  }
  return ($answer | ConvertFrom-Json)
}
function Invoke-LogicalChord($s) {
        # Real key events via keybd_event: "ctrl+shift+n", "ctrl+4", "esc", "enter", "a" ...
        $vk = @{ ctrl=0x11; shift=0x10; alt=0x12; win=0x5B; enter=0x0D; esc=0x1B; tab=0x09; back=0x08; del=0x2E; up=0x26; down=0x28; left=0x25; right=0x27; home=0x24; end=0x23; space=0x20; pagedown=0x22; pageup=0x21;
                 slash=0xBF; comma=0xBC; minus=0xBD; equals=0xBB; backtick=0xC0; period=0xBE; semicolon=0xBA; lbracket=0xDB; rbracket=0xDD; backslash=0xDC; quote=0xDE }
        for ($f = 1; $f -le 12; $f++) { $vk["f$f"] = 0x6F + $f }
        if (-not $s.nofocus) { Focus (Target $s) }
        [void](Target $s $true)
        foreach ($c in @($s.keys)) {
          Start-Phase "input:logical-chord"
          $parts = $c.ToLower().Split("+"); $codes = @()
          foreach ($p in $parts) { if ($vk.ContainsKey($p)) { $codes += $vk[$p] } elseif ($p -match '^[a-z0-9]$') { $codes += [int][char]$p.ToUpper() } else { throw "unknown key '$p' (use names: backtick slash minus equals period comma semicolon quote lbracket rbracket backslash f1-f12 ...)" } }
          $held = New-Object System.Collections.ArrayList
          try {
            foreach ($k in $codes) {
              # Durable first, then the last check, then the key: no file I/O between them (fix 1, MH1).
              $mark = Begin-Input
              try { [void](Target $s $true) } catch { Withdraw-Input $mark; throw }
              [void]$held.Add($k)
              [W32]::keybd_event([byte]$k, 0, 0, [UIntPtr]::Zero)
              Start-Sleep -Milliseconds 30
            }
            [array]::Reverse($codes)
            foreach ($k in $codes) {
              [void](Target $s $true)
              [W32]::keybd_event([byte]$k, 0, 2, [UIntPtr]::Zero)
              $held.RemoveAt($held.Count - 1)
              Set-HeldInput -1
              Start-Sleep -Milliseconds 30
            }
          } finally {
            $releaseFailed = $false
            for ($i = $held.Count - 1; $i -ge 0; $i--) {
              try { [W32]::keybd_event([byte]$held[$i], 0, 2, [UIntPtr]::Zero); Set-HeldInput -1 }
              catch { $releaseFailed = $true }
            }
            if ($releaseFailed) { $script:releaseUncertain = $true; throw "IDENTITY_LOGICAL_RELEASE_FAILED" }
          }
          Start-Sleep -Milliseconds 250; L ("chord " + $c)
        }
}
function Invoke-PhysicalChord($s) {
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
        Start-Phase "input:physical-chord"
        try {
          foreach ($event in @($plan.events)) {
            # A press is durable before its last pin, foreground and HKL checks; nothing between them
            # and SendScan touches the disk (fix 1, MH1). A refused press is withdrawn, never sent.
            if (-not $event.up) { $mark = Begin-Input }
            try {
              [void](Target $s $true)
              if ((TargetHkl $s) -ne $expectedHkl) { throw "PHYSICAL_HKL_MISMATCH" }
            } catch { if (-not $event.up) { Withdraw-Input $mark }; throw }
            if (-not $event.up) { [void]$held.Add($event) }
            if ([W32]::SendScan([uint16]$event.scan, [bool]$event.up, [bool]$event.extended) -ne 1) {
              if (-not $event.up) { $held.RemoveAt($held.Count - 1); Set-HeldInput -1 }
              throw "PHYSICAL_SEND_SHORT"
            }
            if ($event.up) {
              if ($held.Count -eq 0 -or $held[$held.Count - 1].name -ne $event.name) { throw "PHYSICAL_PLAN_INVALID" }
              $held.RemoveAt($held.Count - 1)
              Set-HeldInput -1
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
            try { if ([W32]::SendScan([uint16]$pressed.scan, $true, [bool]$pressed.extended) -ne 1) { $releaseFailed = $true } else { Set-HeldInput -1 } }
            catch { $releaseFailed = $true }
          }
          if ($releaseFailed) { $script:releaseUncertain = $true; throw "PHYSICAL_RELEASE_FAILED" }
        }
        L ("physicalChord success hwnd=" + $targetEl.Current.NativeWindowHandle + " hkl=" + $actualHkl)
}
