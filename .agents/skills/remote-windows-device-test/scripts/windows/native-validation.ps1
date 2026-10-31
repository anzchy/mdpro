# Purpose: validate native budgets and strict step lists across PowerShell parser shapes.
# This is independent of the Mac preflight; no lock, task or input is acquired on rejection.
function Read-NativeInteger([string]$Text, [long]$Minimum, [long]$Maximum) {
  $value = 0L
  if ($Text -notmatch '^[0-9]+$' -or -not [long]::TryParse($Text, [ref]$value) -or $value -lt $Minimum -or $value -gt $Maximum) {
    throw "UI_BUDGET_INVALID"
  }
  return $value
}
function Read-NativeSteps([string]$Encoded) {
  try {
    $bytes = [Convert]::FromBase64String($Encoded)
    if ($bytes.Length -gt 65536) { throw "UI_STEPS_TOO_LARGE" }
    $raw = (New-Object Text.UTF8Encoding($false, $true)).GetString($bytes)
    if ($raw.TrimStart() -notmatch '^\[') { throw "UI_STEPS_INVALID" }
    # Validate the original JSON before wrapping it, so trailing properties cannot be injected.
    $null = $raw | ConvertFrom-Json
    # An object property preserves the outer array in both 5.1 and 7, including null slots.
    $container = ('{"steps":' + $raw + '}') | ConvertFrom-Json
    $steps = $container.steps
    if ($steps.Count -gt 1000) { throw "UI_STEPS_INVALID" }
    $operations = @('windows','focus','max','menuinfo','visible','showall','restore','layout','setLayout','chord','physicalChord','menus','shot','wait','filedialog','dialogReceipt','clickat','menuat','menuclick','open','run','tree')
    foreach ($step in $steps) {
      if ($null -eq $step -or $step -is [array] -or $step -isnot [pscustomobject] -or $step.op -isnot [string] -or $step.op -cnotin $operations) { throw "UI_STEPS_INVALID" }
      if ($step.PSObject.Properties.Name -contains 'window' -and ($step.window -isnot [string] -or -not $step.window)) { throw "UI_STEPS_INVALID" }
    }
    return ,$bytes
  } catch {
    if ($_.Exception.Message -eq 'UI_STEPS_TOO_LARGE') { throw }
    throw "UI_STEPS_INVALID"
  }
}
