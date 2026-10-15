// @vitest-environment node
/**
 * D113-WI-1: the device drag driver's pure planner,
 * `scripts/device/dragPlan.mjs` — `parseDragArgs(argv)` and
 * `buildDragPlan(opts)`.
 *
 * Laws (S4): over seeded valid inputs the plan starts with a mouse-down at the
 * start point, ends with a mouse-up at the end point, carries exactly `steps`
 * dragged events moving monotonically toward the end, never contains a plain
 * `move`, and stamps `alt === copy` on every mouse event. Error texts are
 * pinned as literals, never imported.
 */
import { describe, expect, it } from "vitest";
import { int, mulberry32, pick } from "../support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { buildDragPlan, parseDragArgs } from "../../scripts/device/dragPlan.mjs";

type Opts = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  copy: boolean;
  steps: number;
  holdMs: number;
  stepMs: number;
  settleMs: number;
};
type Ev = { type: string; x?: number; y?: number; ms?: number; alt?: boolean };
type Parsed = { ok: true; opts: Opts } | { ok: false; error: string };

const parse = (argv: string[]): Parsed => parseDragArgs(argv);
const plan = (opts: Opts): Ev[] => buildDragPlan(opts);
const MOUSE = new Set(["down", "dragged", "up"]);

function errorOf(argv: string[]): string {
  const r = parse(argv);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
}

function optsOf(argv: string[]): Opts {
  const r = parse(argv);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.opts;
}

describe("parseDragArgs — success and defaults", () => {
  it("parses four coordinates with every default", () => {
    expect(parse(["10", "20", "300", "400"])).toEqual({
      ok: true,
      opts: {
        x1: 10,
        y1: 20,
        x2: 300,
        y2: 400,
        copy: false,
        steps: 20,
        holdMs: 150,
        stepMs: 16,
        settleMs: 100,
      },
    });
  });

  it("accepts decimals and zero", () => {
    const o = optsOf(["0", "0.5", "12.25", "7"]);
    expect([o.x1, o.y1, o.x2, o.y2]).toEqual([0, 0.5, 12.25, 7]);
  });

  it("reads --copy and every tuning flag, flags before or after coordinates", () => {
    const o = optsOf([
      "--copy",
      "1",
      "2",
      "--steps",
      "2",
      "100",
      "200",
      "--hold-ms",
      "0",
      "--step-ms",
      "2000",
      "--settle-ms",
      "5",
    ]);
    expect(o).toEqual({
      x1: 1,
      y1: 2,
      x2: 100,
      y2: 200,
      copy: true,
      steps: 2,
      holdMs: 0,
      stepMs: 2000,
      settleMs: 5,
    });
  });

  it("accepts the steps bounds 2 and 200", () => {
    expect(optsOf(["0", "0", "10", "0", "--steps", "200"]).steps).toBe(200);
    expect(optsOf(["0", "0", "10", "0", "--steps", "2"]).steps).toBe(2);
  });

  it("accepts a drag of exactly 5 points", () => {
    expect(optsOf(["0", "0", "3", "4"]).x2).toBe(3);
  });
});

describe("parseDragArgs — rejections (never throws)", () => {
  const cases: Array<[string, string[], string]> = [
    ["too few positionals", ["1", "2", "3"], "expected 4 coordinates, got 3"],
    ["no positionals", [], "expected 4 coordinates, got 0"],
    ["extra positional", ["1", "2", "30", "40", "50"], "expected 4 coordinates, got 5"],
    ["NaN", ["NaN", "2", "30", "40"], 'invalid coordinate "NaN"'],
    ["negative", ["1", "-2", "30", "40"], 'invalid coordinate "-2"'],
    ["Infinity", ["1", "2", "Infinity", "40"], 'invalid coordinate "Infinity"'],
    ["exponent", ["1", "2", "3e2", "40"], 'invalid coordinate "3e2"'],
    ["empty", ["1", "2", "", "40"], 'invalid coordinate ""'],
    ["trailing dot", ["1", "2", "30.", "40"], 'invalid coordinate "30."'],
    ["word", ["a", "2", "30", "40"], 'invalid coordinate "a"'],
    ["steps 1", ["0", "0", "50", "50", "--steps", "1"], "--steps must be an integer from 2 to 200"],
    ["steps 201", ["0", "0", "50", "50", "--steps", "201"], "--steps must be an integer from 2 to 200"],
    ["steps decimal", ["0", "0", "50", "50", "--steps", "2.5"], "--steps must be an integer from 2 to 200"],
    ["steps missing", ["0", "0", "50", "50", "--steps"], "--steps needs a value"],
    ["hold negative", ["0", "0", "50", "50", "--hold-ms", "-1"], "--hold-ms must be an integer from 0 to 2000"],
    ["hold 2001", ["0", "0", "50", "50", "--hold-ms", "2001"], "--hold-ms must be an integer from 0 to 2000"],
    ["step-ms word", ["0", "0", "50", "50", "--step-ms", "x"], "--step-ms must be an integer from 0 to 2000"],
    ["settle 2001", ["0", "0", "50", "50", "--settle-ms", "2001"], "--settle-ms must be an integer from 0 to 2000"],
    ["settle missing", ["0", "0", "50", "50", "--settle-ms"], "--settle-ms needs a value"],
    ["unknown flag", ["0", "0", "50", "50", "--fast"], "unknown flag --fast"],
    ["flag with =", ["0", "0", "50", "50", "--steps=4"], "unknown flag --steps=4"],
    ["zero distance", ["10", "10", "10", "10"], "drag distance below 5 points"],
    ["4.99 points", ["0", "0", "4.99", "0"], "drag distance below 5 points"],
    ["diagonal below 5", ["0", "0", "3", "3.99"], "drag distance below 5 points"],
  ];

  it.each(cases)("%s", (_name, argv, message) => {
    expect(errorOf(argv)).toContain(message);
  });

  it("never throws on hostile input", () => {
    const hostile: unknown[] = [undefined, null, [1, 2, 3, 4], ["--steps", null], [{}, {}, {}, {}]];
    for (const h of hostile) {
      const r = parseDragArgs(h);
      expect(r.ok).toBe(false);
      expect(typeof r.error).toBe("string");
    }
  });
});

function mouseEvents(p: Ev[]): Ev[] {
  return p.filter((e) => MOUSE.has(e.type));
}

function checkPlanLaws(o: Opts, p: Ev[]): void {
  const mouse = mouseEvents(p);
  expect(mouse[0]).toEqual({ type: "down", x: o.x1, y: o.y1, alt: o.copy });
  expect(mouse[mouse.length - 1]).toEqual({ type: "up", x: o.x2, y: o.y2, alt: o.copy });

  const dragged = p.filter((e) => e.type === "dragged");
  expect(dragged).toHaveLength(o.steps);
  const lastDrag = dragged[dragged.length - 1];
  expect([lastDrag.x, lastDrag.y]).toEqual([o.x2, o.y2]);

  // Changed after red (rule 12): the per-event checks collect violations and
  // assert once. One expect per event made the 300-input loop ~240k expect
  // calls (~3.8 s, over ADR-0050's 2 s unit-lane budget); the laws are the same.
  const bad: string[] = [];
  let px = o.x1;
  let py = o.y1;
  const sx = Math.sign(o.x2 - o.x1);
  const sy = Math.sign(o.y2 - o.y1);
  for (const [i, d] of dragged.entries()) {
    const x = d.x as number;
    const y = d.y as number;
    if ((x - px) * sx < 0 || (y - py) * sy < 0) bad.push(`dragged[${i}] moves away from the end`);
    if ((sx === 0 && x !== o.x1) || (sy === 0 && y !== o.y1)) bad.push(`dragged[${i}] leaves a fixed axis`);
    if (Math.round(x * 100) / 100 !== x || Math.round(y * 100) / 100 !== y) bad.push(`dragged[${i}] not rounded to 0.01`);
    px = x;
    py = y;
  }
  for (const m of mouse) if (m.alt !== o.copy) bad.push(`${m.type} alt ${String(m.alt)} != copy ${String(o.copy)}`);
  const known = new Set(["altDown", "altUp", "down", "dragged", "up", "wait"]);
  for (const e of p) if (!known.has(e.type)) bad.push(`unknown event type ${e.type}`);
  expect(bad).toEqual([]);
  expect(p.some((e) => e.type === "move" || e.type === "moved")).toBe(false);

  if (o.copy) {
    expect(p[0]).toEqual({ type: "altDown" });
    expect(p[p.length - 1]).toEqual({ type: "altUp" });
    expect(p.filter((e) => e.type === "altDown")).toHaveLength(1);
    expect(p.filter((e) => e.type === "altUp")).toHaveLength(1);
  } else {
    expect(p.some((e) => e.type === "altDown" || e.type === "altUp")).toBe(false);
  }
}

describe("buildDragPlan — exact shape", () => {
  it("lays out a move drag in order with the timing waits", () => {
    const o = optsOf(["0", "0", "10", "20", "--steps", "2"]);
    expect(plan(o)).toEqual([
      { type: "down", x: 0, y: 0, alt: false },
      { type: "wait", ms: 150 },
      { type: "dragged", x: 5, y: 10, alt: false },
      { type: "wait", ms: 16 },
      { type: "dragged", x: 10, y: 20, alt: false },
      { type: "wait", ms: 16 },
      { type: "wait", ms: 100 },
      { type: "up", x: 10, y: 20, alt: false },
    ]);
  });

  it("brackets a copy drag with altDown / altUp and stamps alt on every mouse event", () => {
    const o = optsOf(["100", "50", "40", "50", "--copy", "--steps", "3", "--hold-ms", "7", "--step-ms", "1", "--settle-ms", "9"]);
    expect(plan(o)).toEqual([
      { type: "altDown" },
      { type: "down", x: 100, y: 50, alt: true },
      { type: "wait", ms: 7 },
      { type: "dragged", x: 80, y: 50, alt: true },
      { type: "wait", ms: 1 },
      { type: "dragged", x: 60, y: 50, alt: true },
      { type: "wait", ms: 1 },
      { type: "dragged", x: 40, y: 50, alt: true },
      { type: "wait", ms: 1 },
      { type: "wait", ms: 9 },
      { type: "up", x: 40, y: 50, alt: true },
      { type: "altUp" },
    ]);
  });

  it("rounds intermediate points to 0.01 and lands exactly on an unrounded end", () => {
    const o = optsOf(["0", "0", "10.004", "1", "--steps", "3"]);
    const dragged = plan(o).filter((e) => e.type === "dragged");
    // Changed after red (rule 12): the red expected 3.34 here, an arithmetic
    // slip: 10.004 / 3 = 3.3347, which rounds to 3.33 at 0.01.
    expect(dragged.map((d) => [d.x, d.y])).toEqual([
      [3.33, 0.33],
      [6.67, 0.67],
      [10.004, 1],
    ]);
  });

  // Added after red: the case above carried an arithmetic slip at red (3.34 for
  // 10.004 / 3 = 3.3347); this one pins half-up rounding on a reverse drag.
  it("rounds reverse-direction thirds to 0.01 (added after red)", () => {
    const o = optsOf(["100", "0", "0", "10", "--steps", "3"]);
    const dragged = plan(o).filter((e) => e.type === "dragged");
    expect(dragged.map((d) => [d.x, d.y])).toEqual([
      [66.67, 3.33],
      [33.33, 6.67],
      [0, 10],
    ]);
  });

  it("satisfies the plan laws on the default drag, move and copy", () => {
    checkPlanLaws(optsOf(["10", "20", "300", "400"]), plan(optsOf(["10", "20", "300", "400"])));
    const c = optsOf(["300", "400", "10", "20", "--copy"]);
    checkPlanLaws(c, plan(c));
  });

  it("is deterministic: the same opts give the same plan", () => {
    const o = optsOf(["1.5", "2.5", "99.25", "0", "--copy", "--steps", "7"]);
    expect(plan(o)).toEqual(plan({ ...o }));
  });
});

describe("buildDragPlan — seeded property loop", () => {
  const SEED = 0xd113;
  it(`holds every plan law over 300 random valid inputs (seed ${SEED})`, () => {
    const r = mulberry32(SEED);
    const coord = (): string => pick(r, [String(int(r, 0, 1920)), (int(r, 0, 192000) / 100).toFixed(int(r, 0, 3))]);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const argv = [coord(), coord(), coord(), coord(), "--steps", String(int(r, 2, 200))];
      if (r() < 0.5) argv.push("--copy");
      if (r() < 0.3) argv.push("--hold-ms", String(int(r, 0, 2000)));
      const parsed = parse(argv);
      if (!parsed.ok) {
        expect(parsed.error).toContain("drag distance below 5 points");
        continue;
      }
      const o = parsed.opts;
      const p = plan(o);
      checkPlanLaws(o, p);
      expect(p.filter((e) => e.type === "wait")).toHaveLength(o.steps + 2);
      expect(p).toHaveLength(o.steps * 2 + 4 + (o.copy ? 2 : 0));
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
  });
});
