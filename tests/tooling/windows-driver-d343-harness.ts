import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";
import { budgetFixture } from "./windows-driver-d342-budget-harness";

const execute = promisify(execFile);
export const adapter = String.raw`
function ConvertFrom-Json {
  param([Parameter(ValueFromPipeline=$true)]$InputObject)
  process {
    $p = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $InputObject -NoEnumerate
    if ($p -is [array]) {
      $a = [object[]]::new($p.Count)
      [array]::Copy($p, $a, $p.Count)
      return ,$a
    }
    return $p
  }
}
`;
export type Row = { id: string; b64: string; error?: string };
export type Result = { id: string; shape: string; accepted: boolean; b64: string | null; error: string | null };
export const rawRow = (id: string, raw: string, error?: string): Row => ({ id, b64: Buffer.from(raw).toString("base64"), error });

export async function batch(rows: Row[]) {
  const dir = await budgetFixture();
  await writeFile(path.join(dir, "rows.json"), JSON.stringify(rows));
  await writeFile(path.join(dir, "batch.ps1"), String.raw`
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/native-validation.ps1"
$rows = Get-Content "$PSScriptRoot/rows.json" -Raw | Microsoft.PowerShell.Utility\ConvertFrom-Json
foreach ($shape in @('native','win51')) {
  & {
    if ($shape -eq 'win51') { ${adapter} }
    foreach ($row in $rows) {
      try {
        $bytes = Read-NativeSteps $row.b64
        @{ id=$row.id; shape=$shape; accepted=$true; b64=[Convert]::ToBase64String($bytes); error=$null } | ConvertTo-Json -Compress
      } catch {
        @{ id=$row.id; shape=$shape; accepted=$false; b64=$null; error=$_.Exception.Message } | ConvertTo-Json -Compress
      }
    }
  }
}
`);
  const result = await execute("pwsh", ["-NoProfile", "-File", path.join(dir, "batch.ps1")], { maxBuffer: 8 * 1024 * 1024 });
  const results = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Result);
  expect(results).toHaveLength(rows.length * 2);
  expect(new Set(results.map((r) => r.shape + r.id)).size).toBe(results.length);
  expect(results.map((r) => r.shape + r.id).sort()).toEqual(["native", "win51"].flatMap((shape) => rows.map((r) => shape + r.id)).sort());
  return results;
}
export async function check(rows: Row[]) {
  const results = await batch(rows);
  for (const result of results) {
    const row = rows.find((r) => r.id === result.id)!;
    expect(result, result.shape + ":" + result.id).toEqual({ id: row.id, shape: result.shape,
      accepted: !row.error, b64: row.error ? null : row.b64, error: row.error ?? null });
  }
  return results;
}

export async function probe() {
  const result = await execute("pwsh", ["-NoProfile", "-Command", String.raw`
$ErrorActionPreference='Stop'
${adapter}
foreach ($raw in @('[]','[{"op":"max"}]','[{"op":"max"},{"op":"windows"}]','[null]','[[{"op":"max"}]]')) {
  $captured=@($raw | ConvertFrom-Json)
  $p=$captured[0]
  @{ raw=$raw; emitted=$captured.Count; count=$p.Count; array=($p -is [array]); custom=($p -is [pscustomobject]); firstNull=($p.Count -gt 0 -and $null -eq $p[0]); nested=($p.Count -gt 0 -and $p[0] -is [array]) } | ConvertTo-Json -Compress
}`]);
  return result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

const ssh = `#!/usr/bin/env node
const { spawn } = require("node:child_process"), fs = require("node:fs"), path = require("node:path");
const command = process.argv[process.argv.length - 1];
const match = /-StepsB64 (\\S+) -RunId ([a-f0-9]{32}) -PhaseMs (\\d+) -CleanupMs (\\d+) -PollMs (\\d+) -DeadlineMs (\\d+) -TimeoutSec ([0-9.]+)/.exec(command);
if (!match) { process.stderr.write("Unexpected dispatch\\n"); process.exit(255); }
const names = ["StepsB64", "RunId", "PhaseMs", "CleanupMs", "PollMs", "DeadlineMs", "TimeoutSec"];
fs.appendFileSync(path.join(process.env.TEST_ROOT, "dispatches.jsonl"), JSON.stringify(Object.fromEntries(names.map((name, index) => [name, match[index + 1]]))) + "\\n");
const child = spawn("pwsh", ["-NoProfile", "-File", path.join(process.env.TEST_ROOT, "bridge.ps1"), ...names.flatMap((name, index) => ["-" + name, match[index + 1]])], { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
child.on("close", (code) => process.exit(code === null ? 255 : code));
`;

export async function caller(raw: string) {
  const dir = await budgetFixture();
  const bin = path.join(dir, "bin");
  await mkdir(bin);
  await writeFile(path.join(bin, "ssh"), ssh);
  await chmod(path.join(bin, "ssh"), 0o755);
  await writeFile(path.join(dir, "bridge.ps1"), String.raw`
param($StepsB64,$RunId,$PhaseMs,$CleanupMs,$PollMs,$DeadlineMs,$TimeoutSec)
$ErrorActionPreference='Stop'
${adapter}
& "$PSScriptRoot/ui-run.ps1" @PSBoundParameters
exit $LASTEXITCODE
`);
  const env: NodeJS.ProcessEnv = { ...process.env, TEST_ROOT: dir, PATH: bin + path.delimiter + (process.env.PATH ?? "") };
  for (const name of Object.keys(env)) if (name.startsWith("MDPRO_UI_")) delete env[name];
  const ui = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/mac/ui.sh");
  let stdout = "", stderr = "", status = 0;
  try { ({ stdout, stderr } = await execute("bash", [ui, raw], { env })); }
  catch (error) {
    const failure = error as Error & { code: number; stdout: string; stderr: string };
    if (failure.code !== 1) throw error;
    ({ stdout, stderr } = failure); status = failure.code;
  }
  const dispatches = (await readFile(path.join(dir, "dispatches.jsonl"), "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  return { dir, status, stdout, stderr, dispatches };
}

// Inspect actual cmdlet output independently of validator acceptance.
export async function decodedShapes(rows: { id: string; raw: string }[]) {
  const dir = await budgetFixture();
  await writeFile(path.join(dir, "shape-rows.json"), JSON.stringify(rows));
  await writeFile(path.join(dir, "shapes.ps1"), String.raw`
$ErrorActionPreference = 'Stop'
$rows = Get-Content "$PSScriptRoot/shape-rows.json" -Raw | Microsoft.PowerShell.Utility\ConvertFrom-Json
${adapter}
foreach ($row in $rows) {
  $captured = @($row.raw | ConvertFrom-Json)
  $value = $captured[0]
  $count = $null
  $shapes = @()
  if ($value -is [array]) {
    $count = $value.Count
    foreach ($step in $value) {
      if ($null -eq $step) { $shapes += 'null' }
      elseif ($step -is [array]) { $shapes += 'array' }
      elseif ($step -is [pscustomobject]) { $shapes += 'object' }
      else { $shapes += $step.GetType().Name }
    }
  }
  @{ id=$row.id; count=$count; shapes=$shapes; value=$value } | ConvertTo-Json -Depth 20 -Compress
}
`);
  const result = await execute("pwsh", ["-NoProfile", "-File", path.join(dir, "shapes.ps1")]);
  return result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
}
