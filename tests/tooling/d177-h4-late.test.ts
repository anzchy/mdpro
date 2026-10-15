// @vitest-environment node
/**
 * D177-H-4 (audit b95 M2, addendum): an event accepted below the floor is
 * marked late and does not mislead the readers.
 *
 * - Its record gains `"spool_late": true`; a normal record has no such key.
 * - It is appended to events.jsonl but not mirrored to latest.json, so
 *   last-dtrack keeps showing the newest real event.
 * - wait-dtrack still returns it (exit 0, the record on stdout) and prints
 *   `late seq N (source)` on stderr, so the caller can tell it is old.
 * - The receiver log line for it says "late".
 *
 * Setup: seq 2, then one capped jump to 2 + MAX_MISSING + 50, which raises the
 * floor to 52; seq 1 is then below the floor.
 * Boundaries: a real receiver.py child on 127.0.0.1 with a temp hook dir and
 * fake token; wait-dtrack.sh run with a temp HOME and MDPRO_HOOK_DIR.
 */
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { WAIT, makeTemp, readText, rmTemp } from "../support/d177Hooks";
import { spooled, useReceiver } from "../support/d177ReceiverFixture";

const CAP = 10_000;
const JUMP = 2 + CAP + 50;
const fx = useReceiver();

async function capFloor() {
  await fx.sendSeqs("dtrack-mini", [2, JUMP]);
}

describe("D177-H4 late events", () => {
  it("l1: a below-floor accept leaves latest.json unchanged and is logged as late", async () => {
    await capFloor();
    const latestBefore = readText(fx.file("latest.json"));
    expect(latestBefore).toContain(`"spool_seq": ${JUMP}`);
    expect((await fx.post(spooled(1))).status).toBe(200);
    expect(fx.events().map((r) => r.spool_seq)).toEqual([2, JUMP, 1]);
    expect(readText(fx.file("latest.json"))).toBe(latestBefore);
    const lastLog = fx.log().trim().split("\n").pop() ?? "";
    expect(lastLog).toMatch(/-> 200 late\b/);
    expect(lastLog).toContain("#1");
  });

  it("l2: the late record carries spool_late: true; normal records carry no spool_late key", async () => {
    await capFloor();
    expect((await fx.post(spooled(1))).status).toBe(200);
    expect(fx.events(), "the late event is stored").toHaveLength(3);
    const [two, jump, late] = fx.events();
    expect(late.spool_late).toBe(true);
    expect(Object.keys(two)).not.toContain("spool_late");
    expect(Object.keys(jump)).not.toContain("spool_late");
  });

  it("l3: wait-dtrack returns the late record, exit 0, and prints the late seq line on stderr", async () => {
    await capFloor();
    const home = makeTemp("late-home");
    try {
      const child = spawn("bash", [WAIT, "-t", "8"], {
        env: { ...process.env, HOME: home, MDPRO_HOOK_DIR: fx.dir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout!.on("data", (c) => (stdout += c));
      child.stderr!.on("data", (c) => (stderr += c));
      const done = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
      await new Promise((r) => setTimeout(r, 1500));
      expect((await fx.post(spooled(1))).status).toBe(200);
      const code = await done;
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim()).spool_seq).toBe(1);
      expect(stderr.split("\n")).toContain("late seq 1 (dtrack-mini)");
    } finally {
      rmTemp(home);
    }
  }, 15_000);

  it("l4: wait-dtrack on a normal record prints no late line", async () => {
    await fx.sendSeqs("dtrack-mini", [1]);
    const home = makeTemp("late-home");
    try {
      const child = spawn("bash", [WAIT, "-t", "8"], {
        env: { ...process.env, HOME: home, MDPRO_HOOK_DIR: fx.dir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr!.on("data", (c) => (stderr += c));
      const done = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
      await new Promise((r) => setTimeout(r, 1500));
      await fx.sendSeqs("dtrack-mini", [2]);
      expect(await done).toBe(0);
      expect(stderr).not.toMatch(/^late seq/m);
    } finally {
      rmTemp(home);
    }
  }, 15_000);
});
