// @vitest-environment node
/**
 * D133-WI-1: the drag plan's total-duration cap. A plan whose waits sum to
 * more than `MAX_PLAN_MS` (hold + steps × step-ms + settle) is refused by
 * `parseDragArgs`, by `buildDragPlan` (RangeError) and by the `drag.mjs` /
 * `drag.sh` CLI (exit 64, nothing posted). A 400 s drag outlived the 120 s
 * Bash timeout, which killed the executor with the mouse button held (D133).
 *
 * Law (S4, biconditional): over seeded inputs spanning every flag's full
 * range, a plan is accepted iff its computed total is ≤ the cap, and an
 * accepted plan's waits sum to exactly that total. Messages pinned as literals.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { int, mulberry32 } from "./support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { MAX_PLAN_MS, buildDragPlan, parseDragArgs } from "../scripts/device/dragPlan.mjs";

type Ev = { type: string; ms?: number };
type Parsed = { ok: true; opts: Record<string, number | boolean> } | { ok: false; error: string };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRAG_MJS = path.join(REPO_ROOT, "scripts/device/drag.mjs");
const DRAG_SH = path.join(REPO_ROOT, "scripts/device/drag.sh");

const parse = (argv: string[]): Parsed => parseDragArgs(argv);
const totalWait = (p: Ev[]): number => p.filter((e) => e.type === "wait").reduce((s, e) => s + (e.ms ?? 0), 0);
const capMessage = (total: number): string => `plan duration ${total} ms exceeds the 30000 ms cap`;

/** hold 0 + 15 × 2000 + settle 0 = exactly 30 000 ms. */
const AT_CAP = ["0", "0", "100", "0", "--steps", "15", "--step-ms", "2000", "--hold-ms", "0", "--settle-ms", "0"];

describe("MAX_PLAN_MS", () => {
  it("is the named 30 000 ms cap", () => {
    expect(MAX_PLAN_MS).toBe(30000);
  });
});

describe("parseDragArgs / buildDragPlan — the duration cap", () => {
  it("accepts a plan of exactly 30 000 ms, whose waits sum to 30 000", () => {
    const r = parse(AT_CAP);
    if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
    expect(totalWait(buildDragPlan(r.opts))).toBe(30000);
  });

  it("refuses 30 001 ms reached through --hold-ms, naming the cap and the total", () => {
    const r = parse([...AT_CAP, "--hold-ms", "1"]);
    expect(r).toEqual({ ok: false, error: expect.stringContaining(capMessage(30001)) });
  });

  it("refuses 30 001 ms reached through --settle-ms", () => {
    const r = parse([...AT_CAP, "--settle-ms", "1"]);
    expect(r).toEqual({ ok: false, error: expect.stringContaining(capMessage(30001)) });
  });

  it("refuses the D133 reproducer, 200 steps × 2000 ms (400 250 ms with the defaults)", () => {
    const r = parse(["0", "0", "100", "100", "--steps", "200", "--step-ms", "2000"]);
    expect(r).toEqual({ ok: false, error: expect.stringContaining(capMessage(400250)) });
  });

  it("still accepts the default drag (570 ms)", () => {
    const r = parse(["10", "20", "300", "400"]);
    if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
    expect(totalWait(buildDragPlan(r.opts))).toBe(570);
  });

  it("buildDragPlan throws a RangeError on over-cap opts that bypassed the parser", () => {
    const opts = { x1: 0, y1: 0, x2: 100, y2: 0, copy: false, steps: 15, holdMs: 1, stepMs: 2000, settleMs: 0 };
    expect(() => buildDragPlan(opts)).toThrow(RangeError);
    expect(() => buildDragPlan(opts)).toThrow(capMessage(30001));
  });
});

describe("duration cap — seeded property loop", () => {
  const SEED = 0xd133;
  it(`accepts a plan iff its total is ≤ the cap, and its waits sum to that total (seed ${SEED})`, () => {
    const r = mulberry32(SEED);
    const bad: string[] = [];
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 400; i++) {
      const steps = int(r, 2, 200);
      const holdMs = int(r, 0, 2000);
      const settleMs = int(r, 0, 2000);
      // Half the draws keep step-ms small so both sides of the cap are well populated.
      const stepMs = r() < 0.5 ? int(r, 0, 150) : int(r, 0, 2000);
      const total = holdMs + steps * stepMs + settleMs;
      const argv = ["0", "0", "500", "500", "--steps", String(steps), "--hold-ms", String(holdMs),
        "--step-ms", String(stepMs), "--settle-ms", String(settleMs)];
      if (r() < 0.5) argv.push("--copy");
      const res = parse(argv);
      if (res.ok) {
        accepted++;
        if (total > MAX_PLAN_MS) bad.push(`accepted over-cap total ${total}`);
        const sum = totalWait(buildDragPlan(res.opts));
        if (sum !== total) bad.push(`waits sum ${sum} != total ${total}`);
        if (sum > MAX_PLAN_MS) bad.push(`plan waits ${sum} over the cap`);
      } else {
        refused++;
        if (total <= MAX_PLAN_MS) bad.push(`refused in-cap total ${total}: ${res.error}`);
        if (!res.error.includes(capMessage(total))) bad.push(`wrong message for ${total}: ${res.error}`);
      }
    }
    expect(bad).toEqual([]);
    expect(accepted).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(50);
  });
});

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("drag.mjs / drag.sh — the cap at the CLI", () => {
  it("drag.mjs exits 64 on the D133 reproducer, naming cap and total, with nothing on stdout", () => {
    const r = spawnSync(process.execPath, [DRAG_MJS, "0", "0", "100", "100", "--steps", "200", "--step-ms", "2000"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(r.status).toBe(64);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`drag: ${capMessage(400250)}`);
    expect(r.stderr).toContain("usage: drag.sh x1 y1 x2 y2");
  });

  it("drag.mjs prints a plan of exactly 30 000 ms and exits 0", () => {
    const r = spawnSync(process.execPath, [DRAG_MJS, ...AT_CAP], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(totalWait(JSON.parse(r.stdout))).toBe(30000);
  });

  it("drag.sh exits 64 on an over-cap plan and never starts the executor", () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "d133-drag-"));
    tmps.push(binDir);
    const bin = path.join(binDir, "drag-bin");
    fs.writeFileSync(bin, `#!/bin/sh\ncat > "${binDir}/stdin.txt"\necho ran > "${binDir}/ran.txt"\n`);
    fs.chmodSync(bin, 0o755);
    const r = spawnSync("/bin/sh", [DRAG_SH, ...AT_CAP, "--hold-ms", "1"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, MDPRO_DRAG_BIN_DIR: binDir },
    });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain(`drag: ${capMessage(30001)}`);
    expect(fs.existsSync(path.join(binDir, "ran.txt"))).toBe(false);
    expect(fs.existsSync(path.join(binDir, "stdin.txt"))).toBe(false);
  });
});
