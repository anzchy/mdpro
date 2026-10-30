// @vitest-environment node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareNative } from "./windows-driver-native-harness";
import { kernelSource } from "./windows-driver-native-job-harness";

describe("D337 run dispatch containment", () => {
  it("executes a helper only after assigning its lifetime, waits for its exit and drains it", async () => {
    const fixture = await prepareNative([]);
    const helper = path.join(fixture.dir, "helper.cjs");
    await writeFile(helper, `const fs=require('fs'),p=require('path');const root=process.env.JOB_TEST_ROOT;
const gate=p.join(root,'gate-'+process.pid);setTimeout(()=>{fs.writeFileSync(p.join(root,'helper-effect'),fs.existsSync(gate)?fs.readFileSync(gate):'unowned');},100);`);
    await writeFile(fixture.stepsPath, JSON.stringify([{ op: "run", exe: process.execPath, args: '"' + helper + '"' }]));
    await writeFile(path.join(fixture.dir, "kernel.cs"), await kernelSource());
    let script = await readFile(fixture.scriptPath, "utf8");
    script = script.replace('if ($env:MDPRO_NATIVE_JOB) { . "$PSScriptRoot\\native-job.ps1" }', `
Add-Type -Path "$PSScriptRoot/kernel.cs"
$scope=New-Object NativeJobScope ("Global\\mdpro-driver-"+("a"*32))
$env:MDPRO_NATIVE_JOB=$scope.Name
`);
    script += '\n$scope.Stop(); [NativeJobScope]::ReapFixtures()\n';
    await writeFile(fixture.scriptPath, script);
    await writeFile(path.join(fixture.dir, "trace"), "");
    const result = await new Promise<{ status: number | null; stderr: string }>((done) => {
      const child = spawn("pwsh", ["-NoProfile", "-File", fixture.scriptPath, "-Steps", fixture.stepsPath, "-Out", fixture.outPath], {
        env: { ...process.env, JOB_TEST_ROOT: fixture.dir, MDPRO_TEST_SCENARIO: "{}", MDPRO_TEST_TRACE: fixture.tracePath },
      });
      let stderr = "";
      child.stderr.on("data", (v) => { stderr += String(v); });
      child.on("close", (status) => done({ status, stderr }));
    });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(path.join(fixture.dir, "helper-effect"), "utf8")).toBe("owned");
    const trace = await readFile(path.join(fixture.dir, "trace"), "utf8");
    expect(trace).toContain("assign:");
    expect(trace).toMatch(/resume:\d+:True|resume:\d+:true/);
    const log = JSON.parse(await readFile(fixture.outPath, "utf8")) as string[];
    expect(log.join(" ")).toContain("ran " + process.execPath);
  }, 20000);
  it.each([false, true])("executes helper after lifetime assignment and denies requested breakaway=%s", async (breakaway) => {
    const fixture = await prepareNative([]);
    const helper = path.join(fixture.dir, "helper.cjs");
    await writeFile(helper, `const fs=require('fs'),p=require('path');const root=process.env.JOB_TEST_ROOT;
const gate=p.join(root,'gate-'+process.pid);setTimeout(()=>{fs.writeFileSync(p.join(root,'helper-effect'),fs.existsSync(gate)?fs.readFileSync(gate):'unowned');},100);`);
    await writeFile(fixture.stepsPath, JSON.stringify([{ op: "run", exe: process.execPath, args: '"' + helper + '"' }]));
    await writeFile(path.join(fixture.dir, "kernel.cs"), await kernelSource());
    let script = await readFile(fixture.scriptPath, "utf8");
    script = script.replace('if ($env:MDPRO_NATIVE_JOB) { . "$PSScriptRoot\\native-job.ps1" }', `
Add-Type -Path "$PSScriptRoot/kernel.cs"
$scope=New-Object NativeJobScope ("Global\\mdpro-driver-"+("a"*32))
$env:MDPRO_NATIVE_JOB=$scope.Name
`);
    script += '\n$scope.Stop(); [NativeJobScope]::ReapFixtures()\n';
    await writeFile(fixture.scriptPath, script);
    await writeFile(path.join(fixture.dir, "trace"), "");
    const result = await new Promise<{ status: number | null; stderr: string }>((done) => {
      const child = spawn("pwsh", ["-NoProfile", "-File", fixture.scriptPath, "-Steps", fixture.stepsPath, "-Out", fixture.outPath], {
        env: { ...process.env, JOB_TEST_ROOT: fixture.dir, JOB_TEST_BREAKAWAY: breakaway ? "1" : "0", MDPRO_TEST_SCENARIO: "{}", MDPRO_TEST_TRACE: fixture.tracePath },
      });
      let stderr = "";
      child.stderr.on("data", (v) => { stderr += String(v); });
      child.on("close", (status) => done({ status, stderr }));
    });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(path.join(fixture.dir, "helper-effect"), "utf8")).toBe("owned");
    const trace = await readFile(path.join(fixture.dir, "trace"), "utf8");
    expect(trace).toContain("assign:");
    expect(trace).toMatch(/resume:\d+:True|resume:\d+:true/);
    if (breakaway) {
      expect(trace).toContain("breakaway-denied");
      expect(trace).not.toContain("breakaway-allowed");
      await expect(readFile(path.join(fixture.dir, "escaped"), "utf8")).rejects.toThrow();
    }
    const log = JSON.parse(await readFile(fixture.outPath, "utf8")) as string[];
    expect(log.join(" ")).toContain("ran " + process.execPath);
  }, 20000);
});
