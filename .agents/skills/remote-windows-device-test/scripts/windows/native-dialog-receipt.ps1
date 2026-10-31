# Purpose: the scoped modal-owner receipt (D336). A `dialogReceipt` step in the run that binds A
# through the CDP title challenge pins a receipt-only window property on A while that challenge
# still holds, restores A's title before any modal opens, and stores the receipt on this host
# (an unlabelled step uses the sole route instead: no challenge, nothing to restore, label "")
# under the SHA-256 of a random 64-hex token; only the token goes back to the caller. A later
# `filedialog` with that token, in a separate invocation with no CDP, consumes it exactly once by
# an atomic move, then trusts only native observations: the stored owner, its process lifetime
# and the pin. It expires 30000 ms after issue (exact expiry is invalid). A replacement for the
# same owner, and any expired receipt, is invalidated at the next issue. The store holds inert
# state only: no task, worker or held input outlives a run. Contract: ../../reference/ops.md.
$script:receiptDir = "$PSScriptRoot\dialog-receipts"
$script:receiptLifetimeMs = 30000
function Get-ReceiptNowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function New-ReceiptSecret {
  $bytes = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}
function Get-ReceiptHash([string]$Secret) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return -join ($sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($Secret)) | ForEach-Object { $_.ToString("x2") }) }
  finally { $sha.Dispose() }
}
# Removes a stored receipt and, when its owner still carries it, its pin. Reports, never throws.
function Remove-ReceiptRecord([string]$Path, $Record) {
  try {
    if ($Record -and $Record.pinKey) {
      $h = [IntPtr]([int64]$Record.owner.hwnd)
      if ([W32]::GetProp($h, [string]$Record.pinKey).ToInt64().ToString() -ceq [string]$Record.pinValue) { [void][W32]::RemoveProp($h, [string]$Record.pinKey) }
    }
    Remove-Item -LiteralPath $Path -Force
  } catch { L ("receipt invalidation failed " + [IO.Path]::GetFileName($Path)) }
}
function Restore-ReceiptTitle([string]$Label, $Token) {
  if (-not $script:markers.ContainsKey($Label)) { return }
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{ nonce = $script:markers[$Label].nonce } | ConvertTo-Json -Compress)))
  $restored = Invoke-NodeBounded "receipt-title-restore" @("$PSScriptRoot\cdp.mjs", "--window", $Label, "unbind", $b64) -AllowFailure
  if ($LASTEXITCODE -ne 0 -or -not $restored) { throw "IDENTITY_TITLE_RESTORE_FAILED label=$Label" }
  $script:markers.Remove($Label)
  $Token.challenge = $null # from here the run's own pin, not the title, proves A
  L "receipt title restored label=$Label"
}
function Invoke-DialogReceipt($s) {
  # Labelled: A is bound through the title challenge. Unlabelled: the sole route, one unowned
  # mdpro window from native observations alone, with no challenge to restore and label "".
  [void](Target $s)
  $label = if ($null -ne $s.window) { [string]$s.window } else { "" }
  $token = $script:bindings[$(if ($label) { "label:$label" } else { "sole" })]
  Start-Phase "receipt-issue"
  [void][IO.Directory]::CreateDirectory($script:receiptDir)
  $now = Get-ReceiptNowMs
  foreach ($file in @(Get-ChildItem -LiteralPath $script:receiptDir -Filter "*.json" -File)) {
    $old = try { Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null }
    if (-not $old -or [string]$old.owner.hwnd -ceq [string]$token.hwnd -or $now -ge [long]$old.expiresMs) { Remove-ReceiptRecord $file.FullName $old }
  }
  $h = [IntPtr]([int64]$token.hwnd)
  $pinKey = "mdpro-receipt-" + (New-ReceiptSecret).Substring(0, 32)
  $pinValue = [string](Get-Random -Minimum 1 -Maximum 2147483647)
  [void](ValidateNative $token $false) # the challenge still holds while the pin is set
  if (-not [W32]::SetProp($h, $pinKey, [IntPtr]([int64]$pinValue))) { throw "IDENTITY_RECEIPT_PIN_FAILED" }
  try { if ($label) { Restore-ReceiptTitle $label $token } }
  catch { [void][W32]::RemoveProp($h, $pinKey); throw }
  Start-Phase "receipt-issue"
  $secret = New-ReceiptSecret; $issued = Get-ReceiptNowMs
  $record = @{ owner = @{ hwnd = [string]$token.hwnd; pid = [int]$token.pid; birth = [string]$token.birth; rect = @($token.rect); label = $label };
               pinKey = $pinKey; pinValue = $pinValue; issuedMs = $issued; expiresMs = $issued + $script:receiptLifetimeMs }
  $path = Join-Path $script:receiptDir ((Get-ReceiptHash $secret) + ".json")
  [IO.File]::WriteAllText("$path.tmp", ($record | ConvertTo-Json -Compress -Depth 6), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath "$path.tmp" -Destination $path
  L ("receipt " + $secret)
  Complete-Phase
}
# Consumes the step's receipt and returns the stored owner as a native token. The move is the
# consumption: a second consumer, a forged or an edited token finds nothing. Whatever follows,
# the receipt is gone; the owner is kept as binding "receipt" so cleanup removes its pin.
function Use-DialogReceipt($s) {
  Start-Phase "receipt-consume"
  $secret = $s.receipt
  if ($secret -isnot [string] -or $secret -cnotmatch '^[a-f0-9]{64}$') { throw "IDENTITY_RECEIPT_INVALID" }
  $path = Join-Path $script:receiptDir ((Get-ReceiptHash $secret) + ".json")
  $taken = "$path.consumed-$RunId"
  try { [IO.File]::Move($path, $taken) } catch { throw "IDENTITY_RECEIPT_INVALID" }
  try { $record = Get-Content -LiteralPath $taken -Raw -Encoding UTF8 | ConvertFrom-Json }
  finally { Remove-Item -LiteralPath $taken -Force -ErrorAction SilentlyContinue }
  $owner = [pscustomobject]@{ label = [string]$record.owner.label; hwnd = [string]$record.owner.hwnd; pid = [int]$record.owner.pid;
    birth = [string]$record.owner.birth; rect = @($record.owner.rect); challenge = $null;
    nativeKey = [string]$record.pinKey; nativeValue = [string]$record.pinValue }
  $script:bindings["receipt"] = $owner
  if ((Get-ReceiptNowMs) -ge [long]$record.expiresMs) { throw "IDENTITY_RECEIPT_EXPIRED" }
  if ($null -ne $s.window -and [string]$s.window -cne $owner.label) { throw "IDENTITY_RECEIPT_LABEL_MISMATCH" }
  [void](ValidateNative $owner $false)
  Complete-Phase
  L ("receipt consumed owner=" + $owner.hwnd)
}
