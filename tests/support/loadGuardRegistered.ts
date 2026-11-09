/**
 * Purpose: the "registered wrapper beside an unwrapped runner" load-guard scenario (#731), shared by its tests.
 * A heavy-lock wrapper registers its group in `active/`; two backstop ticks run `gapMs` apart; the backstop must
 * leave the registered group alone and stop only the unwrapped runner. Returns what happened; tests assert on it.
 *
 * Key decisions: the wrapper's own monitor stops it after two critical readings, so its sampler reads critical only
 * once the scenario writes `release` after the second tick, and the wrapped child sleeps 60 s. The wrapper's
 * lifetime no longer depends on the ticks landing inside its 1.6–2 s monitor window (#731: they missed it under
 * load). The monitor thresholds are untouched.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runChild, waitForExit } from "./loadGuardChild";

const backstop = path.resolve("scripts/load-guard/backstop.py");
const wrapperScript = path.resolve("scripts/heavy-lock.sh");
const REGISTRATION_WAIT_MS = 3_000;
const POLL_MS = 20;
const xctest = (dir: string) =>
  "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest " + path.join(dir, "Packages/PicseeKit/.build/debug/PicseeKitPackageTests.xctest");

export type RegisteredWrapperOutcome = {
  registrations: number;
  /** The registered wrapper's pid answered signal 0 after both backstop ticks. */
  registeredAliveAfterTicks: boolean;
  looseStopped: boolean;
  wrapperCode: number | null;
  stops: number;
  wrapperStops: number;
  looseStops: number;
};

export async function registeredWrapperScenario(gapMs: number, signal: AbortSignal): Promise<RegisteredWrapperOutcome> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-backstop-together-"));
  const active = path.join(dir, "active");
  const log = path.join(dir, "log");
  const wrapperSampler = path.join(dir, "wrapper-sampler");
  const backstopSampler = path.join(dir, "backstop-sampler");
  const release = path.join(dir, "release");
  fs.writeFileSync(wrapperSampler, `#!/bin/sh\nif [ -e '${release}' ]; then echo '4 0 16'; else echo '1 0 16'; fi\n`, { mode: 0o700 });
  fs.writeFileSync(backstopSampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
  const common = { ...process.env, MDPRO_HEAVY_LOCK_HELD: undefined, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir,
    MDPRO_LOAD_GUARD_ACTIVE: active, MDPRO_LOAD_GUARD_LOG: log };
  const wrapped = spawn(wrapperScript, ["/bin/bash", "-c", "sleep 60"], {
    env: { ...common, MDPRO_HEAVY_LOCK: path.join(dir, "lock"), MDPRO_LOAD_GUARD_SAMPLER: wrapperSampler,
      MDPRO_LOAD_GUARD_INTERVAL_SECS: "0.8" }, stdio: "ignore", detached: true,
  });
  const loose = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  let registeredGroup: number | undefined;
  try {
    const deadline = Date.now() + REGISTRATION_WAIT_MS;
    while ((!fs.existsSync(active) || fs.readdirSync(active).length === 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    const entries = fs.existsSync(active) ? fs.readdirSync(active) : [];
    if (entries.length !== 1) throw new Error(`expected one registration, found ${entries.length}`);
    const registration = JSON.parse(fs.readFileSync(path.join(active, entries[0]), "utf8"));
    registeredGroup = registration.pgid;
    const processes = path.join(dir, "processes.json");
    fs.writeFileSync(processes, JSON.stringify([registration.pgid, loose.pid].map((pid) => ({
      pid, ppid: process.pid, pgid: pid, uid: process.getuid!(), cwd: dir, command: xctest(dir),
    }))));
    const env = { ...common, MDPRO_LOAD_GUARD_SAMPLER: backstopSampler, MDPRO_LOAD_GUARD_PROCESSES: processes,
      MDPRO_LOAD_GUARD_STATE: path.join(dir, "state") };
    const tick = async () => {
      const result = await runChild("python3", [backstop, "--once"], { env, signal });
      if (result.status !== 0) throw new Error(`backstop tick exited ${result.status}: ${result.stderr}`);
    };
    await tick();
    await new Promise((resolve) => setTimeout(resolve, gapMs));
    await tick();
    let registeredAliveAfterTicks = true;
    try { process.kill(registration.pid, 0); } catch { registeredAliveAfterTicks = false; }
    fs.writeFileSync(release, "");
    await waitForExit(loose, signal);
    let looseStopped = false;
    try { process.kill(loose.pid!, 0); } catch { looseStopped = true; }
    const wrapperCode = await waitForExit(wrapped, signal);
    const stops = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((record) => record.event === "stop");
    return {
      registrations: entries.length, registeredAliveAfterTicks, looseStopped, wrapperCode, stops: stops.length,
      wrapperStops: stops.filter((record) => String(record.cmd).startsWith("bash sha256:")).length,
      looseStops: stops.filter((record) => String(record.cmd).startsWith("xctest sha256:")).length,
    };
  } finally {
    for (const group of [wrapped.pid, loose.pid, registeredGroup]) {
      if (group) try { process.kill(-group, "SIGKILL"); } catch { /* already gone */ }
    }
    await Promise.all([waitForExit(wrapped), waitForExit(loose)]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
