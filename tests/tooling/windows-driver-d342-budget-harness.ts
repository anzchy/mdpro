import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WINDOWS = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows");
export const LATCH = "D342 pre-existing latch; do not dispatch input\n";
export const RUN = "d".repeat(32);
export type BudgetRow = { id: string; values?: Record<string, string>; deadlineOffset?: number; accepted: boolean };
export type BudgetResult = { id: string; status: number; lines: string[] };

/** Real entry and validator, stopped safely by their real post-validation latch guard. */
export async function budgetFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mdpro-d342-budget-"));
  await Promise.all(["ui-run.ps1", "native-validation.ps1"].map((name) => cp(path.join(WINDOWS, name), path.join(dir, name))));
  await writeFile(path.join(dir, "native-session-blocked.json"), LATCH);
  return dir;
}

/** Each real script invocation gets a fresh start clock; no production text is rewritten. */
export async function runBudgetBatch(dir: string, rows: BudgetRow[]) {
  await writeFile(path.join(dir, "rows.json"), JSON.stringify(rows));
  await writeFile(path.join(dir, "batch.ps1"), String.raw`
$ErrorActionPreference = "Stop"
foreach ($row in (Get-Content -LiteralPath "$PSScriptRoot/rows.json" -Raw | ConvertFrom-Json)) {
  $nativeArgs = @{ StepsB64 = "W3sib3AiOiJ3YWl0IiwibXMiOjB9XQ=="; RunId = "dddddddddddddddddddddddddddddddd";
    PhaseMs = "5000"; CleanupMs = "5000"; PollMs = "10";
    DeadlineMs = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 30000).ToString(); TimeoutSec = "90" }
  if ($null -ne $row.deadlineOffset) { $nativeArgs.DeadlineMs = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $row.deadlineOffset).ToString() }
  if ($row.values) { foreach ($property in $row.values.PSObject.Properties) { $nativeArgs[$property.Name] = [string]$property.Value } }
  $encoded = & "$PSScriptRoot/ui-run.ps1" @nativeArgs
  $status = $LASTEXITCODE
  $lines = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$encoded)) | ConvertFrom-Json)
  @{ id = $row.id; status = $status; lines = $lines } | ConvertTo-Json -Compress -Depth 10
}
`);
  const result = await execFileAsync("pwsh", ["-NoProfile", "-File", path.join(dir, "batch.ps1")], { encoding: "utf8", timeout: 15000 });
  return result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as BudgetResult);
}

export function outcome(lines: string[]) {
  const line = lines.find((value) => value.startsWith("OUTCOME "));
  if (!line) throw new Error("Missing real native OUTCOME: " + lines.join("\n"));
  return JSON.parse(line.slice(8)) as Record<string, unknown>;
}

export async function latchBytes(dir: string) { return readFile(path.join(dir, "native-session-blocked.json"), "utf8"); }
