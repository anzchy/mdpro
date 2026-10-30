import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareNative } from "./windows-driver-native-harness";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

// Production worker under the real supervisor: ui-run.ps1 -> (fake Scheduler/kernel job) -> the
// production ui.ps1 with its native-window/runtime/input/ops helpers. Doubles stay at the OS
// boundary only: Win32 (the native harness's W32), UIA (the types below), process enumeration,
// the node launch (a PATH shim that runs the real resolver/cdp.mjs) and CDP (a fake endpoint).
// MDPRO_TEST_STALL names the one boundary that blocks; the launcher stands in for ui.cmd/native-job.exe.
export type ProductionStall = "none" | "discovery" | "uia" | "uia-read" | "resolver" | "stdout";

const fakeUia = String.raw`Add-Type @"
namespace System.Windows.Automation {
  public enum TreeScope { Element = 1, Children = 2, Descendants = 4 }
  public sealed class ControlType { public static readonly ControlType Window = new ControlType(), Edit = new ControlType(); }
  public sealed class AutomationProperty { }
  public sealed class PropertyCondition { public PropertyCondition(AutomationProperty p, object v) { } }
  public sealed class Information {
    public long NativeWindowHandle { get { AutomationElement.Stall("uia-read"); return 101; } }
    public int ProcessId { get { return 11; } }
    public string Name { get { return "mdpro"; } }
  }
  public sealed class AutomationElement {
    public static readonly AutomationProperty ControlTypeProperty = new AutomationProperty(), NameProperty = new AutomationProperty(), ClassNameProperty = new AutomationProperty();
    public static void Stall(string boundary) { if (System.Environment.GetEnvironmentVariable("MDPRO_TEST_STALL") == boundary) System.Threading.Thread.Sleep(60000); }
    public static AutomationElement RootElement { get { return new AutomationElement(); } }
    public Information Current { get { return new Information(); } }
    public AutomationElement[] FindAll(TreeScope scope, PropertyCondition condition) { Stall("uia"); return new[] { new AutomationElement() }; }
  }
}
"@
`;

// Every node child is recorded as an input-job member, as the kernel job owns it on Windows.
const nodeShim = (realNode: string) => `#!/bin/bash
echo $$ >> "$TEST_ROOT/members"
case "$MDPRO_TEST_STALL:$1" in
  resolver:*window-binding.mjs) exec sleep 60 ;;
  stdout:*window-binding.mjs) "${realNode}" "$@"; rc=$?; sleep 60 & echo $! >> "$TEST_ROOT/members"; exit $rc ;;
esac
exec "${realNode}" "$@"
`;

const launcher = `
[IO.File]::AppendAllText("$env:TEST_ROOT/members", "$PID" + [Environment]::NewLine)
$runDir = "$env:TEST_ROOT/runs/$env:TEST_RUN_ID"
$start = Get-ChildItem -LiteralPath $runDir -Filter "scheduler-*.json" | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } | Where-Object { $_.op -eq "start" }
$command = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($start.arguments -split " ")[-1]))
if ($command -notmatch ' ([a-f0-9]{32}) ([0-9]+) ([0-9]+) ([0-9]+)"$') { throw "launcher: ui.cmd arguments changed" }
[IO.File]::WriteAllText("$env:TEST_ROOT/started", "ready")
$global:LASTEXITCODE = 0
& "$env:TEST_ROOT/ui-production.ps1" -Steps "$runDir/steps.json" -Out "$runDir/ui-out.json" -RunId $Matches[1] -DeadlineMs $Matches[2] -PhaseMs $Matches[3] -CleanupMs $Matches[4]
$code = if ($LASTEXITCODE) { $LASTEXITCODE } else { 0 }
[IO.File]::WriteAllText("$env:TEST_ROOT/task-exit", [string]$code)
exit $code
`;

/** exitStatus "propagated" is the real chain (ui.cmd and native-job.exe return ui.ps1's code); "lost" reads 0. */
export async function productionWorkerFixture(stall: ProductionStall, steps: unknown[], options: {
  cdpPort?: number; titlePath?: string; entry?: Record<string, string>; exitStatus?: "propagated" | "lost";
} = {}) {
  const prepared = await prepareNative([]);
  let script = await readFile(prepared.scriptPath, "utf8");
  const fixtureWindows = /function MdproWindows \{\n {2}\[IO\.File\]::AppendAllText[\s\S]*?\n\}\n/;
  const processDouble = "function Get-Process { param($Id, $ErrorAction) ";
  if (!fixtureWindows.test(script) || !script.includes(processDouble) || !script.includes("$AE = $null")) {
    throw new Error("native harness fixture changed");
  }
  script = script.replace(fixtureWindows, "")
    .replace(processDouble, processDouble + 'if ($env:MDPRO_TEST_STALL -eq "discovery" -and [string]$Id -eq "tauri-app") { [Threading.Thread]::Sleep(60000) }; ')
    .replace("[void][W32]::SetProcessDPIAware()", () => fakeUia + "[void][W32]::SetProcessDPIAware()")
    .replace("$AE = $null", "$AE = [System.Windows.Automation.AutomationElement]")
    .replace("$TS = $null", "$TS = [System.Windows.Automation.TreeScope]");
  const fixture = await supervisorFixture("production", {
    // A 3 s phase leaves room for a first exec of a new script; stalls block for 60 s.
    steps, entry: { DeadlineMs: String(Date.now() + 30000), PhaseMs: "3000", ...options.entry },
  });
  const bin = path.join(fixture.dir, "bin");
  const trace = path.join(fixture.dir, "trace.txt");
  await mkdir(bin);
  await Promise.all([
    writeFile(path.join(fixture.dir, "ui-production.ps1"), script),
    writeFile(path.join(fixture.dir, "worker.ps1"), launcher),
    writeFile(path.join(bin, "node"), nodeShim(process.execPath)),
    writeFile(trace, ""),
  ]);
  await chmod(path.join(bin, "node"), 0o755);
  // The first exec of a new script can take seconds on macOS; pay it here, outside every phase budget.
  execFileSync(path.join(bin, "node"), ["-e", "0"], { env: { ...process.env, TEST_ROOT: bin, MDPRO_TEST_STALL: "none" } });
  const env: Record<string, string> = {
    PATH: bin + path.delimiter + (process.env.PATH ?? ""), MDPRO_TEST_STALL: stall,
    MDPRO_TEST_SCENARIO: "{}", MDPRO_TEST_TRACE: trace,
  };
  if ((options.exitStatus ?? "propagated") === "propagated") env.TEST_TASK_EXIT_FILE = path.join(fixture.dir, "task-exit");
  if (options.cdpPort) env.MDPRO_CDP_PORT = String(options.cdpPort);
  if (options.titlePath) env.MDPRO_TEST_TITLE = options.titlePath;
  return {
    ...fixture, trace,
    start: (id = fixture.runId) => fixture.start(id, env),
    async traceLines() { return (await readFile(trace, "utf8")).split("\n").filter(Boolean); },
  };
}
