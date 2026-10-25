# Purpose: talk to mdpro's MCP sidecar over stdio (JSON-RPC, one message per line).
$p = New-Object System.Diagnostics.Process
$p.StartInfo.FileName = $(if ($env:MDPRO_MCP_EXE) { $env:MDPRO_MCP_EXE } else { "D:\programs\mdpro\mdpro_mcp.exe" })
$p.StartInfo.UseShellExecute = $false; $p.StartInfo.RedirectStandardInput = $true; $p.StartInfo.RedirectStandardOutput = $true; $p.StartInfo.RedirectStandardError = $true
$p.StartInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
[void]$p.Start()
function Send($o) { $p.StandardInput.WriteLine(($o | ConvertTo-Json -Compress -Depth 8)); $p.StandardInput.Flush() }
function Recv { $t = $p.StandardOutput.ReadLineAsync(); if ($t.Wait(8000)) { $t.Result } else { "TIMEOUT" } }
Send @{ jsonrpc = "2.0"; id = 1; method = "initialize"; params = @{ protocolVersion = "2024-11-05"; capabilities = @{}; clientInfo = @{ name = "audit"; version = "1" } } }
$init = Recv; "INIT " + $init.Substring(0, [Math]::Min(220, $init.Length))
Send @{ jsonrpc = "2.0"; method = "notifications/initialized" }
Send @{ jsonrpc = "2.0"; id = 2; method = "tools/list" }
$tl = Recv; $names = ([regex]::Matches($tl, '"name":"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }); "TOOLS " + ($names -join ", ")
Send @{ jsonrpc = "2.0"; id = 3; method = "tools/call"; params = @{ name = "get_open_documents"; arguments = @{} } }
$od = Recv; "OPEN_DOCS " + $od.Substring(0, [Math]::Min(400, $od.Length))
$p.StandardInput.Close(); if (-not $p.WaitForExit(3000)) { $p.Kill() }
