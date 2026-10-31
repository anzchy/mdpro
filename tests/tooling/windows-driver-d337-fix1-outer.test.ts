// @vitest-environment node
/**
 * D337 fix 1 (opus H1, MH2): the Mac waits on the outer bound, not on the Windows deadline.
 * Coupled path: the real ui.sh → ui-transaction.py → common.sh `win` → an `ssh` double that runs
 * the real ui-run.ps1 and supervisor (Scheduler and kernel job substituted) with the arguments
 * the Mac sent. The worker completes every phase but never the run, so only the transaction
 * deadline ends it, and its cleanup uses the whole reserve. The caller must get the phase-named
 * OUTCOME and the latch must be written, never a transport kill. ui-run.ps1 also honours
 * -TimeoutSec: its own run never outlives that bound, measured on its own clock.
 */
import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const UI = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/mac/ui.sh");
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
function reap(pids: number[]) { for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } } }

// The ssh double: accepts only a ui-run dispatch and runs it in the fixture, as Windows would.
const ssh = `#!/usr/bin/env node
const { spawn } = require("child_process"), path = require("path");
const cmd = process.argv[process.argv.length - 1];
const m = /-StepsB64 (\\S+) -RunId ([a-f0-9]{32}) -PhaseMs (\\d+) -CleanupMs (\\d+) -PollMs (\\d+) -DeadlineMs (\\d+) -TimeoutSec ([0-9.]+)/.exec(cmd);
if (!m) { process.stderr.write("ssh double: not a ui-run dispatch\\n"); process.exit(255); }
const names = ["StepsB64", "RunId", "PhaseMs", "CleanupMs", "PollMs", "DeadlineMs", "TimeoutSec"];
const child = spawn("pwsh", ["-NoProfile", "-File", path.join(process.env.TEST_ROOT, "ui-run.ps1"), ...names.flatMap((n, i) => ["-" + n, m[i + 1]])],
  { env: { ...process.env, TEST_RUN_ID: m[2] }, stdio: ["ignore", "inherit", "inherit"] });
child.on("close", (code) => process.exit(code === null ? 255 : code));
`;

describe("D337 fix 1 the Mac's wait outlasts a Windows run that uses its whole deadline", () => {
  it("a transaction-deadline stall reaches the caller as the phase-named outcome, with the latch written", async () => {
    const fixture = await supervisorFixture("deadline-stall");
    const bin = path.join(fixture.dir, "ssh-bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "ssh"), ssh);
    await chmod(path.join(bin, "ssh"), 0o755);
    const env = { ...process.env, PATH: bin + path.delimiter + (process.env.PATH ?? ""), TEST_ROOT: fixture.dir, TEST_SCENARIO: "deadline-stall",
      MDPRO_UI_PHASE_MS: "3000", MDPRO_UI_CLEANUP_MS: "3000", MDPRO_UI_TRANSACTION_MS: "15000", MDPRO_UI_OUTER_MS: "30000", MDPRO_UI_POLL_MS: "10" };
    try {
      const result = await new Promise<{ status: number | null; stdout: string }>((done) => {
        const child = spawn("bash", [UI, JSON.stringify([{ op: "wait", ms: 0 }])], { env });
        let stdout = "";
        child.stdout.on("data", (v) => { stdout += String(v); });
        child.stderr.on("data", () => undefined);
        child.on("close", (status) => done({ status, stdout }));
      });
      // The OUTCOME names the stalled worker phase (as the transaction timeout, or as the poll in flight
      // at the work deadline reporting `worker-phase=`), never the generic `native-transport` loss.
      const named = /OUTCOME \{.*"phase":"[^"]*NATIVE_(?:TRANSACTION|PHASE)_TIMEOUT [^"]*phase=deadline-stall/.test(result.stdout);
      const latched = await exists(path.join(fixture.dir, "native-session-blocked.json"));
      expect({ named, latched }, result.stdout).toEqual({ named: true, latched: true });
    } finally {
      const members = await readFile(path.join(fixture.dir, "members"), "utf8").catch(() => "");
      reap(members.trim().split("\n").filter(Boolean).map(Number));
    }
  }, 60000);

  it("ui-run.ps1 bounds its own run by -TimeoutSec when the deadline it was given lies beyond it", async () => {
    const requested = Date.now() + 20000;
    const fixture = await supervisorFixture("success", { entry: { DeadlineMs: String(requested), TimeoutSec: "8" } });
    await fixture.start().result;
    const given = Number(await readFile(path.join(fixture.dir, "worker-deadline"), "utf8"));
    expect(given).toBeLessThan(requested - 5000);
  }, 30000);
});
