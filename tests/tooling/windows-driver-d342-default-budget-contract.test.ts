// @vitest-environment node
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { budgetFixture, LATCH, latchBytes, outcome } from "./windows-driver-d342-budget-harness";

const UI = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/mac/ui.sh");
const ssh = `#!/usr/bin/env node
const { spawn } = require("node:child_process"), fs = require("node:fs"), path = require("node:path");
const command = process.argv[process.argv.length - 1];
const match = /-StepsB64 (\\S+) -RunId ([a-f0-9]{32}) -PhaseMs (\\d+) -CleanupMs (\\d+) -PollMs (\\d+) -DeadlineMs (\\d+) -TimeoutSec ([0-9.]+)/.exec(command);
if (!match) { process.stderr.write("Unexpected dispatch\\n"); process.exit(255); }
const names = ["StepsB64", "RunId", "PhaseMs", "CleanupMs", "PollMs", "DeadlineMs", "TimeoutSec"];
fs.appendFileSync(path.join(process.env.TEST_ROOT, "dispatches.jsonl"), JSON.stringify(Object.fromEntries(names.map((name, index) => [name, match[index + 1]]))) + "\\n");
const child = spawn("pwsh", ["-NoProfile", "-File", path.join(process.env.TEST_ROOT, "ui-run.ps1"), ...names.flatMap((name, index) => ["-" + name, match[index + 1]])], { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
child.on("close", (code) => process.exit(code === null ? 255 : code));
`;

describe("D342 real Mac defaults agree with real Windows entry validation", () => {
  it("feeds the actual default argument line through the real ui-run latch guard", async () => {
    const dir = await budgetFixture();
    const bin = path.join(dir, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "ssh"), ssh);
    await chmod(path.join(bin, "ssh"), 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, TEST_ROOT: dir, PATH: bin + path.delimiter + (process.env.PATH ?? "") };
    for (const name of Object.keys(env)) if (name.startsWith("MDPRO_UI_")) delete env[name];
    const before = Date.now();
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
      const child = spawn("bash", [UI, JSON.stringify([{ op: "wait", ms: 0 }])], { env });
      let stdout = "", stderr = "";
      child.stdout.on("data", (value) => { stdout += String(value); });
      child.stderr.on("data", (value) => { stderr += String(value); });
      child.on("close", (status) => done({ status, stdout, stderr }));
    });
    expect(result.status, result.stderr + result.stdout).toBe(1);
    expect(outcome(result.stdout.trim().split(/\r?\n/))).toMatchObject({ phase: "setup: NATIVE_RECONCILIATION_REQUIRED", completedSteps: 0, inputOutcome: "none", heldInput: "released" });
    const dispatches = (await readFile(path.join(dir, "dispatches.jsonl"), "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({ PhaseMs: "5000", CleanupMs: "5000", PollMs: "25", TimeoutSec: "90" });
    expect(Number(dispatches[0].DeadlineMs)).toBeGreaterThanOrEqual(before + 30000);
    expect(Number(dispatches[0].DeadlineMs)).toBeLessThanOrEqual(Date.now() + 30000);
    expect(await latchBytes(dir)).toBe(LATCH);
    expect((await readdir(dir)).sort()).toEqual(["bin", "dispatches.jsonl", "native-session-blocked.json", "native-validation.ps1", "ui-run.ps1"]);
  }, 15000);
});
