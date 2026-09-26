/**
 * WI-4 (D24 follow-up) — the global `windowState` belongs to `main` alone.
 *
 * Cases wo1-wo3 (`ownsGlobalWindowState`, the gate) and wa1-wa6
 * (`windowStateAction`, the action) of the matrix
 * `.claude/tdd-guardian/tests-20260926-062337.md`.
 *
 * Pure, no mocks: `src/utils/windowGeometry.ts` imports nothing at runtime.
 * No property library is in the repo, so every S4 case runs over an
 * enumerated domain transcribed below.
 */
import { describe, expect, it } from "vitest";

import {
  clampToWorkArea,
  ownsGlobalWindowState,
  windowStateAction,
  type WindowGeometry,
  type WindowStateRecord,
  type WorkArea,
} from "../src/utils/windowGeometry";

const fmt = (g: WindowGeometry | null) =>
  g === null ? "null" : `{x:${g.x},y:${g.y},w:${g.width},h:${g.height}}`;

const rect = (s: WindowStateRecord): WindowGeometry => ({
  x: s.x,
  y: s.y,
  width: s.width,
  height: s.height,
});

const NEAR_MISS_LABELS = [
  "mdpro-abc",
  "",
  "Main",
  "MAIN",
  "main ",
  " main",
  "main-2",
  "mainwindow",
  "mdpro-main",
  "mdpro-3f2a9c1e-7b4d-4e2a-9f1c-0a1b2c3d4e5f",
];

describe("ownsGlobalWindowState — the gate (WI-4)", () => {
  // wo1 — S1
  it("wo1: `main` owns the global window state", () => {
    expect(ownsGlobalWindowState("main")).toBe(true);
  });

  // wo2 — S3: each input kills a named wrong predicate
  it.each(NEAR_MISS_LABELS)("wo2: near-miss label %j does not own it", (label) => {
    expect(ownsGlobalWindowState(label)).toBe(false);
  });

  // wo3 — S4: exactly one owner across the enumerated label domain
  it("wo3: exactly one label in the domain owns the global state", () => {
    const generated = Array.from(
      { length: 20 },
      (_, i) => `mdpro-${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    const host = "xmainx";
    const embedded = Array.from(
      { length: host.length + 1 },
      (_, i) => `${host.slice(0, i)}main${host.slice(i)}`,
    );
    const domain = ["main", ...NEAR_MISS_LABELS, ...generated, host, ...embedded];

    expect(domain.filter(ownsGlobalWindowState)).toEqual(["main"]);
  });
});

const MAC_WORK_AREA: WorkArea = { x: 0, y: 0, width: 1440, height: 900 };

describe("windowStateAction — the action (WI-4)", () => {
  // wa1 — S1: literal, hand-computed expectation
  it("wa1: owner + normal state gives a clamped `set`", () => {
    expect(
      windowStateAction(
        true,
        { x: 200, y: 200, width: 2400, height: 1600, isMaximized: false },
        MAC_WORK_AREA,
      ),
    ).toEqual({ kind: "set", geometry: { x: 0, y: 0, width: 1440, height: 900 } });
  });

  // wa2 — S2
  it("wa2: owner + isMaximized gives `maximize`, even for an off-screen rectangle", () => {
    const result = windowStateAction(
      true,
      { x: 9000, y: 9000, width: 100, height: 100, isMaximized: true },
      MAC_WORK_AREA,
    );
    expect(result).toEqual({ kind: "maximize" });
    expect(Object.keys(result)).toEqual(["kind"]);
  });

  // wa3 — S3: the gate precedes the maximize check
  it("wa3: a non-owner with isMaximized skips; it does not maximize", () => {
    expect(
      windowStateAction(
        false,
        { x: 100, y: 100, width: 1200, height: 800, isMaximized: true },
        MAC_WORK_AREA,
      ),
    ).toEqual({ kind: "skip" });
  });

  // wa4 — S2: no monitor → clamp against the record itself
  it("wa4: owner with no monitor clamps against the record itself", () => {
    const state = { x: -50, y: 10, width: 300, height: 200, isMaximized: false };
    const result = windowStateAction(true, state, null);
    expect(result).toEqual({
      kind: "set",
      geometry: { x: -50, y: 10, width: 600, height: 400 },
    });
    expect(result).toEqual({
      kind: "set",
      geometry: clampToWorkArea(rect(state), rect(state)),
    });
  });

  // Shared wa5/wa6 domain: the WI2-F clamp domain (tests/window-geometry-units.test.ts).
  const RECTS: WindowGeometry[] = [
    { x: 200, y: 200, width: 2400, height: 1600 },
    { x: 100, y: 100, width: 1200, height: 800 },
    { x: -500, y: -200, width: 1200, height: 800 },
    { x: 5000, y: 5000, width: 800, height: 600 },
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 99999, height: 99999 },
  ];
  const STATES: WindowStateRecord[] = [
    ...RECTS.flatMap((r) => [
      { ...r, isMaximized: false },
      { ...r, isMaximized: true },
    ]),
    // DEFAULT_PREFERENCES.windowState (src/services/preferencesService.ts)
    { width: 1200, height: 800, x: 100, y: 100, isMaximized: false },
  ];
  const WORK_AREAS: Array<WorkArea | null> = [
    { x: 0, y: 0, width: 1440, height: 900 },
    { x: 0, y: 0, width: 1728, height: 1117 },
    { x: 1440, y: -200, width: 1920, height: 1080 },
    { x: 0, y: 0, width: 320, height: 240 },
    null,
  ];

  // wa5 — S4: the three-part law over the enumerated domain
  it("wa5: non-owners always skip; the owner gets today's maximize / clamped set", () => {
    let checked = 0;
    for (const owner of [false, true]) {
      for (const s of STATES) {
        for (const wa of WORK_AREAS) {
          const label = `owner=${owner} s=${fmt(rect(s))} max=${s.isMaximized} wa=${fmt(wa)}`;
          const result = windowStateAction(owner, s, wa);
          if (!owner) {
            expect(result, label).toEqual({ kind: "skip" });
          } else {
            const expected = s.isMaximized
              ? { kind: "maximize" }
              : { kind: "set", geometry: clampToWorkArea(rect(s), wa ?? rect(s)) };
            expect(result, label).toEqual(expected);
            expect(result.kind, label).not.toBe("skip");
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(2 * STATES.length * WORK_AREAS.length);
  });

  // wa6 — S5: `set` is a fixed point
  it("wa6: applying the action to its own `set` geometry returns the same action", () => {
    let checked = 0;
    for (const s of STATES.filter((st) => !st.isMaximized)) {
      for (const wa of WORK_AREAS.filter((w): w is WorkArea => w !== null)) {
        const label = `s=${fmt(rect(s))} wa=${fmt(wa)}`;
        const r1 = windowStateAction(true, s, wa);
        expect(r1.kind, label).toBe("set");
        if (r1.kind !== "set") continue;
        const r2 = windowStateAction(true, { ...r1.geometry, isMaximized: false }, wa);
        expect(r2, label).toEqual(r1);
        checked += 1;
      }
    }
    expect(checked).toBe(7 * 4);
  });
});
