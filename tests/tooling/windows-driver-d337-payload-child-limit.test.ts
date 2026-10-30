// @vitest-environment node
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scripts = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts");
const fixtures: string[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function runPayload(raw: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "mdpro-child-limit-"));
  fixtures.push(dir);
  await copyFile(path.join(scripts, "windows/native-validation.ps1"), path.join(dir, "native-validation.ps1"));
  await writeFile(path.join(dir, "ui-run.ps1"), String.raw`param($StepsB64,$RunId,$PhaseMs,$CleanupMs,$PollMs,$DeadlineMs,$TimeoutSec)
. "$PSScriptRoot/native-validation.ps1"
try { $bytes=Read-NativeSteps $StepsB64 } catch { Write-Error $_; exit 2 }
[IO.File]::WriteAllBytes("$PSScriptRoot/received.json",$bytes)
[IO.File]::AppendAllText("$PSScriptRoot/effects","dispatch"+[Environment]::NewLine)
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('["completed"]'))
exit 0
`);
  // Fake only the OS launch boundary: the expanded argv is serialized with the
  // Windows quoting rule and counted in UTF-16, including executable and NUL.
  await writeFile(path.join(dir, "native-proxy.ps1"), String.raw`function Quote-WindowsArgument([string]$value) {
  if ($value.Length -gt 0 -and $value -notmatch '[\s"]') { return $value }
  $quoted=[regex]::Replace($value,'(\\*)"','$1$1\"')
  $quoted=[regex]::Replace($quoted,'(\\+)$','$1$1')
  return '"'+$quoted+'"'
}
function global:powershell {
  $nativeArgs=@($args)
  $commandLine='"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" '+(($nativeArgs | ForEach-Object { Quote-WindowsArgument ([string]$_) }) -join ' ')
  $units=$commandLine.Length+1
  [IO.File]::AppendAllText("$env:CHILD_LIMIT_FIXTURE/launches.jsonl",($units | ConvertTo-Json -Compress)+[Environment]::NewLine)
  if ($units -gt 32767) { throw "WINDOWS_CHILD_COMMAND_TOO_LONG UTF16=$units LIMIT=32767" }
  & pwsh @nativeArgs
}
`);
  await writeFile(path.join(dir, "ssh"), String.raw`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),cp=require('child_process');
const dir=process.env.CHILD_LIMIT_FIXTURE,command=process.argv.at(-1);
fs.appendFileSync(p.join(dir,'commands.jsonl'),JSON.stringify(command)+'\n');
if(Buffer.byteLength(command)>8000){process.stderr.write('SSH_EXEC_TOO_LONG\n');process.exit(255);}
const script=". '"+dir+"/native-proxy.ps1'; "+command.replaceAll(process.env.REMOTE_PREFIX,dir);
const r=cp.spawnSync('pwsh',['-NoProfile','-Command',script],{encoding:'utf8',env:process.env});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);
`, { mode: 0o755 });
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn("bash", [path.join(scripts, "mac/ui.sh"), raw], {
      env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, REMOTE_PREFIX: "C:\\Users\\jack\\mdpro-audit", CHILD_LIMIT_FIXTURE: dir, MDPRO_WIN_OUT: dir },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (v) => { stdout += String(v); });
    child.stderr.on("data", (v) => { stderr += String(v); });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const lines = async (name: string) => (await readFile(path.join(dir, name), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  return {
    ...result, dir,
    commands: (await lines("commands.jsonl")).map((line) => JSON.parse(line) as string),
    launches: (await lines("launches.jsonl")).map((line) => JSON.parse(line) as number),
    received: await readFile(path.join(dir, "received.json"), "utf8").catch(() => null),
    effects: await readFile(path.join(dir, "effects"), "utf8").catch(() => ""),
  };
}

describe("D337 Windows child-launch payload boundary independent of SSH", () => {
  it("delivers the exact 64 KiB JSON once with no oversized Windows child command", async () => {
    const steps = [{ op: "run", exe: "C:\\helper.exe", args: "" }];
    steps[0].args = "a".repeat(65536 - Buffer.byteLength(JSON.stringify(steps)));
    const raw = JSON.stringify(steps);
    expect(Buffer.byteLength(raw)).toBe(65536);
    const result = await runPayload(raw);
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands.every((command) => Buffer.byteLength(command) <= 8000)).toBe(true);
    expect(result.launches).toHaveLength(1);
    expect(result.launches[0]).toBeLessThanOrEqual(32767);
    expect(JSON.parse(result.received!)).toEqual(steps);
    expect(result.effects).toBe("dispatch\n");
    expect((await readdir(result.dir)).filter((name) => name.endsWith(".b64"))).toEqual([]);
  }, 60000);

  it("delivers all 1000 Unicode steps once without Windows child argument expansion", async () => {
    const steps = Array.from({ length: 1000 }, (_, i) => ({ op: "wait", ms: 0, note: "测😀" + i }));
    const result = await runPayload(JSON.stringify(steps));
    expect(result.status, result.stderr).toBe(0);
    expect(result.launches).toHaveLength(1);
    expect(result.launches[0]).toBeLessThanOrEqual(32767);
    expect(JSON.parse(result.received!)).toEqual(steps);
    expect(result.effects).toBe("dispatch\n");
  }, 60000);

  it.each([
    ["oversized JSON", JSON.stringify([{ op: "wait", note: "a".repeat(65536) }]), "UI_STEPS_TOO_LARGE"],
    ["invalid operation in large JSON", JSON.stringify([{ op: "invalid", note: "a".repeat(15000) }]), "UI_STEPS_INVALID"],
  ])("refuses %s before upload or native launch", async (_name, raw, error) => {
    const result = await runPayload(raw);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(error);
    expect(result.commands).toEqual([]);
    expect(result.launches).toEqual([]);
    expect(result.received).toBeNull();
    expect(result.effects).toBe("");
  });
});
