// @vitest-environment node
/**
 * ADR-0047 WI-003 review fix WI-R2: the real process-fact boundary on the
 * paths no earlier case reached (the WI-9 91% per-file branch floor):
 * `process.kill(pid, 0)` liveness through `doctor.defaultProcFacts`, the
 * pid guard in `readStartTime` / `readExe`, an exe whose file is gone, and
 * the verify scan's shape. None was red; written after the WI-R2 red record.
 * These are the paired real-boundary checks for the `fakeProcFacts` the
 * driver tests use.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Round 4 changes
 * (review fixes, WI-R2)", PF-R1..PF-R4.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { readExe, readStartTime, scanVerifyPids } from "../../scripts/control/procFacts.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { defaultProcFacts } from "../../scripts/control/doctor.mjs";

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.reverse()) d();
  disposers = [];
});

const isRoot = process.getuid?.() === 0;

/** A pid that just exited, so it is free on any host (a fixed number such as
 * 999999 can be a live process where `pid_max` is 4194304, as on Linux/WSL). */
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid as number;
}

describe("WI-R2 procFacts: the real boundary", () => {
  it("PF-R1 alive via signal 0: self true, a free pid false, pid 1 true, 0 and 2**31 unknown", async () => {
    const pf = defaultProcFacts();
    const got = {
      self: await pf.alive(process.pid),
      free: await pf.alive(await exitedPid()),
      init: await pf.alive(1),
      zero: await pf.alive(0),
      huge: await pf.alive(2 ** 31),
    };
    expect(got).toEqual({ self: true, free: false, init: true, zero: "unknown", huge: "unknown" });
  });

  it("PF-R2 invalid pids are never looked up; a free pid's exe is unknown", async () => {
    const got: string[] = [];
    for (const pid of [0, -1, 1.5]) got.push(await readStartTime(pid), await readExe(pid));
    got.push(await readExe(await exitedPid()));
    expect(got).toEqual(Array(7).fill("unknown"));
  });

  it.skipIf(process.platform !== "darwin" || isRoot)("PF-R3 a running binary whose file was deleted: exe unknown", async () => {
    const dir = fs.mkdtempSync("/tmp/pfr-");
    disposers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bin = path.join(dir, "sleeper");
    fs.copyFileSync("/bin/sleep", bin);
    fs.chmodSync(bin, 0o755);
    const child: ChildProcess = spawn(bin, ["30"], { stdio: "ignore" });
    disposers.push(() => child.kill("SIGKILL"));
    await new Promise<void>((res, rej) => {
      child.once("spawn", () => res());
      child.once("error", rej);
    });
    expect(await readExe(child.pid as number)).toBe(fs.realpathSync(bin));
    fs.unlinkSync(bin);
    expect(await readExe(child.pid as number)).toBe("unknown");
  });

  it("PF-R4 the verify scan is a list of positive safe integers, or unknown", async () => {
    const scan: unknown = await scanVerifyPids();
    const ok = scan === "unknown" || (Array.isArray(scan) && scan.every((p) => Number.isSafeInteger(p) && p > 0));
    expect({ scan, ok }).toEqual({ scan, ok: true });
  });
});
