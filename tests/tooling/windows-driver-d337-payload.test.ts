// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const UI = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/mac/ui.sh");
const fixtures: string[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function runPayload(raw: string, failAppend = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "mdpro-payload-"));
  fixtures.push(dir);
  await writeFile(path.join(dir, "ui-run.ps1"), `param($StepsB64,$RunId,$PhaseMs,$CleanupMs,$PollMs,$DeadlineMs,$TimeoutSec)
$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($StepsB64))
[IO.File]::WriteAllText("$PSScriptRoot/received.json",$json)
[IO.File]::AppendAllText("$PSScriptRoot/effects","dispatch\n")
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('["completed"]'))
exit 0
`);
  await writeFile(path.join(dir, "ssh"), String.raw`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),cp=require('child_process');
const dir=process.env.PAYLOAD_FIXTURE,command=process.argv.at(-1);
fs.appendFileSync(p.join(dir,'commands.jsonl'),JSON.stringify(command)+'\n');
if(Buffer.byteLength(command)>8000){process.stderr.write('exec request failed: command too long\n');process.exit(255);}
const script=command.replaceAll(process.env.REMOTE_PREFIX,dir).replace(/\bpowershell\b/g,'pwsh');
const r=cp.spawnSync('pwsh',['-NoProfile','-Command',script],{encoding:'utf8',env:process.env});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
if(process.env.FAIL_APPEND==='1'&&command.includes('AppendAllText')){process.stderr.write('Connection reset after append\n');process.exit(255);}
process.exit(r.status??1);
`, { mode: 0o755 });
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn("bash", [UI, raw], { env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, REMOTE_PREFIX: "C:\\Users\\jack\\mdpro-audit", PAYLOAD_FIXTURE: dir, FAIL_APPEND: failAppend ? "1" : "0", MDPRO_WIN_OUT: dir } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (v) => { stdout += String(v); });
    child.stderr.on("data", (v) => { stderr += String(v); });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
  const commands = (await readFile(path.join(dir, "commands.jsonl"), "utf8")).trim().split("\n").map((s) => JSON.parse(s) as string);
  const received = await readFile(path.join(dir, "received.json"), "utf8").catch(() => null);
  const effects = await readFile(path.join(dir, "effects"), "utf8").catch(() => "");
  return { ...result, dir, commands, received, effects };
}

describe("D337 valid payload transport across the Windows SSH command boundary", () => {
  it("delivers the exact 64 KiB boundary once without an oversized remote command", async () => {
    const steps = [{ op: "run", exe: "C:\\helper.exe", args: "" }];
    const empty = JSON.stringify(steps);
    steps[0].args = "a".repeat(65536 - Buffer.byteLength(empty));
    const raw = JSON.stringify(steps);
    expect(Buffer.byteLength(raw)).toBe(65536);
    const result = await runPayload(raw);
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands.every((c) => Buffer.byteLength(c) <= 8000)).toBe(true);
    expect(JSON.parse(result.received!)).toEqual(steps);
    expect(result.effects).toBe("dispatch\n");
    expect((await readdir(result.dir)).filter((name) => name.endsWith(".b64"))).toEqual([]);
  }, 60000);

  it("preserves all 1000 valid steps and Unicode without truncating the batch", async () => {
    const steps = Array.from({ length: 1000 }, (_, i) => ({ op: "wait", ms: 0, note: "测😀" + i }));
    const result = await runPayload(JSON.stringify(steps));
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands.every((c) => Buffer.byteLength(c) <= 8000)).toBe(true);
    expect(JSON.parse(result.received!)).toEqual(steps);
    expect(result.effects).toBe("dispatch\n");
  }, 60000);

  it("does not replay a lost append or dispatch any partial upload", async () => {
    const result = await runPayload(JSON.stringify([{ op: "run", exe: "C:\\helper.exe", args: "a".repeat(15000) }]), true);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toContain("UNKNOWN OUTCOME");
    expect(result.commands.filter((c) => c.includes("AppendAllText"))).toHaveLength(1);
    expect(result.received).toBeNull();
    expect(result.effects).toBe("");
  }, 30000);
});
