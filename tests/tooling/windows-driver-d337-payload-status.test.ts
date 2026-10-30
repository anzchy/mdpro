// @vitest-environment node
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scripts = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts");
const fixtures: string[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function runPayload(mode: "success" | "nonzero" | "crash") {
  const dir = await mkdtemp(path.join(tmpdir(), "mdpro-payload-status-"));
  fixtures.push(dir);
  await copyFile(path.join(scripts, "windows/native-validation.ps1"), path.join(dir, "native-validation.ps1"));
  await writeFile(path.join(dir, "ui-run.ps1"), String.raw`param($StepsB64,$RunId,$PhaseMs,$CleanupMs,$PollMs,$DeadlineMs,$TimeoutSec)
. "$PSScriptRoot/native-validation.ps1"
try { $bytes=Read-NativeSteps $StepsB64 } catch { Write-Error $_; exit 2 }
[IO.File]::WriteAllBytes("$PSScriptRoot/received.json",$bytes)
[IO.File]::WriteAllText("$PSScriptRoot/child.pid",[string]$PID)
[IO.File]::AppendAllText("$PSScriptRoot/effects","dispatch"+[Environment]::NewLine)
$outcome=if($env:PAYLOAD_MODE -eq 'success'){'completed'}else{'partial'}
[IO.File]::AppendAllText("$PSScriptRoot/effects",$outcome+[Environment]::NewLine)
$answer=@{runId=$RunId;phase='native-dispatch';status=$outcome;inputOutcome=$outcome;completedEffects=1} | ConvertTo-Json -Compress
[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($answer)))
[Console]::Out.Flush()
if($env:PAYLOAD_MODE -eq 'crash'){[Diagnostics.Process]::GetCurrentProcess().Kill()}
if($env:PAYLOAD_MODE -eq 'nonzero'){exit 37}
exit 0
`);
  // This is the Windows OS/native-launch boundary only. Run an actual external
  // child, then model Windows' signed access-violation NTSTATUS explicitly;
  // macOS's truncated process status alone cannot represent 0xC0000005.
  await writeFile(path.join(dir, "native-proxy.ps1"), String.raw`function global:powershell {
  [IO.File]::AppendAllText("$env:PAYLOAD_FIXTURE/launches",[string]$PID+[Environment]::NewLine)
  & pwsh @args
  $portable=$LASTEXITCODE
  $nativeCode=$portable
  if($env:PAYLOAD_MODE -eq 'crash' -and $portable -ne 0){$nativeCode=-1073741819}
  @{portable=$portable;windows=$nativeCode} | ConvertTo-Json -Compress | Set-Content "$env:PAYLOAD_FIXTURE/native-exit.json"
  $global:LASTEXITCODE=$nativeCode
  if($nativeCode -ne 0){Write-Error "NATIVE_BOUNDARY_EXIT portable=$portable windows=$nativeCode" -ErrorAction Continue}
}
`);
  await writeFile(path.join(dir, "ssh"), String.raw`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),cp=require('child_process');
const dir=process.env.PAYLOAD_FIXTURE,command=process.argv.at(-1);
fs.appendFileSync(p.join(dir,'commands.jsonl'),JSON.stringify(command)+'\n');
if(Buffer.byteLength(command)>8000){process.stderr.write('SSH_EXEC_TOO_LONG\n');process.exit(255);}
const script=". '"+dir+"/native-proxy.ps1'; "+command.replaceAll(process.env.REMOTE_PREFIX,dir);
const r=cp.spawnSync('pwsh',['-NoProfile','-Command',script],{encoding:'utf8',env:process.env});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);
`, { mode: 0o755 });
  const steps = [{ op: "wait", ms: 0, note: "测😀".repeat(1200) }, { op: "wait", ms: 0 }];
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn("bash", ["-c", 'bash "$1" "$2" && printf dependent > "$3"', "payload-caller", path.join(scripts, "mac/ui.sh"), JSON.stringify(steps), path.join(dir, "dependent")], {
      env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, REMOTE_PREFIX: "C:\\Users\\jack\\mdpro-audit", PAYLOAD_FIXTURE: dir, PAYLOAD_MODE: mode, MDPRO_WIN_OUT: dir },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (value) => { stdout += String(value); });
    child.stderr.on("data", (value) => { stderr += String(value); });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const read = (name: string) => readFile(path.join(dir, name), "utf8").catch(() => "");
  return {
    ...result, dir, steps,
    nativeExit: JSON.parse(await read("native-exit.json")) as { portable: number; windows: number },
    childPid: Number(await read("child.pid")),
    launches: (await read("launches")).trim().split("\n").filter(Boolean).map(Number),
    commands: (await read("commands.jsonl")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string),
    received: JSON.parse(await read("received.json")),
    effects: await read("effects"), dependent: await read("dependent"),
  };
}

describe("D337 large payload native status survives cleanup and real ps_wrap", () => {
  it.each([
    ["nonzero", 37, 37],
    ["crash", 70, -1073741819],
    ["success", 0, 0],
  ] as const)("retains %s outcome without replay or dependent mutation after failure", async (mode, status, windowsCode) => {
    const result = await runPayload(mode);
    // Check the executed boundary before the status assertion: fixture/compiler
    // failure cannot masquerade as the requested behavioral RED.
    expect(result.nativeExit.windows).toBe(windowsCode);
    expect(result.nativeExit.portable).toBe(mode === "crash" ? 137 : windowsCode);
    expect(result.launches).toHaveLength(1);
    expect(result.childPid).toBeGreaterThan(0);
    expect(result.childPid).not.toBe(result.launches[0]);
    expect(result.received).toEqual(result.steps);
    expect(result.commands.length).toBeGreaterThan(1);
    expect(result.commands.every((command) => Buffer.byteLength(command) <= 8000)).toBe(true);
    expect(result.effects).toBe(`dispatch\n${mode === "success" ? "completed" : "partial"}\n`);
    expect((await readdir(result.dir)).filter((name) => name.endsWith(".b64"))).toEqual([]);
    const output = JSON.parse(result.stdout.trim());
    expect(output).toEqual({ runId: expect.stringMatching(/^[0-9a-f]{32}$/), phase: "native-dispatch", status: mode === "success" ? "completed" : "partial", inputOutcome: mode === "success" ? "completed" : "partial", completedEffects: 1 });
    expect(result.status, result.stderr).toBe(status);
    expect(result.dependent).toBe(mode === "success" ? "dependent" : "");
  }, 30000);
});
