// @vitest-environment node
/**
 * WI-2 — pure physical<->logical window geometry conversion and work-area clamp.
 *
 * Cases WI2-A .. WI2-J of the ADR-0031 test matrix
 * (.claude/tdd-guardian/tests-20260923-152800.md lines 159-312).
 *
 * No mocks, by design: `src/utils/windowGeometry.ts` is forbidden to import
 * anything from `@tauri-apps/*`, `../stores/*` or `../services/*`, so a stray
 * Tauri import would fail this whole file at module load under jsdom.
 */
import { describe, expect, it } from "vitest";

import {
  clampToWorkArea,
  logicalToPhysical,
  physicalToLogical,
  type WindowGeometry,
  type WindowSize,
  type WorkArea,
} from "../src/utils/windowGeometry";

const MIN: WindowSize = { width: 600, height: 400 };

const fmt = (g: { x: number; y: number; width: number; height: number }) =>
  `{x:${g.x},y:${g.y},w:${g.width},h:${g.height}}`;

describe("windowGeometry — physicalToLogical / logicalToPhysical", () => {
  // WI2-A — Law (S5): round-trip identity over an enumerated grid x five scale factors.
  it("WI2-A round-trips every enumerated logical geometry at every scale factor >= 1", () => {
    const X = [-1600, -601, -1, 0, 1, 100, 200, 1439, 2400];
    const W = [600, 601, 799, 800, 1200, 1201, 1600, 2400];
    const S = [1, 1.25, 1.5, 2, 3];

    // Diagonal enumeration (zip, not the full 5-fold product), but with the
    // paired axis rotated by one so that x !== y and width !== height in every
    // sample. A straight `zip(X, X)` would make every geometry square and
    // diagonal, and could not distinguish "scales x but not y".
    const positions = X.map((x, i) => ({ x, y: X[(i + 1) % X.length] }));
    const sizes = W.map((w, i) => ({ width: w, height: W[(i + 1) % W.length] }));

    let combinations = 0;
    for (const p of positions) {
      for (const s of sizes) {
        const g: WindowGeometry = { ...p, ...s };
        for (const scale of S) {
          const roundTripped = physicalToLogical(logicalToPhysical(g, scale), scale);
          expect(
            roundTripped,
            `round-trip failed for g=${fmt(g)} at scaleFactor=${scale}`,
          ).toEqual(g);
          combinations += 1;
        }
      }
    }

    expect(combinations).toBe(X.length * W.length * S.length);
  });

  // WI2-B — the literal on-disk witness from ~/.mdpro/config.json.
  it("WI2-B converts the inflated on-disk record 2400x1600@2 to 1200x800 logical", () => {
    expect(physicalToLogical({ x: 200, y: 200, width: 2400, height: 1600 }, 2)).toEqual({
      x: 100,
      y: 100,
      width: 1200,
      height: 800,
    });
  });

  // WI2-C — scaleFactor === 1 is the identity in both directions.
  it("WI2-C treats scaleFactor 1 as the identity in both directions", () => {
    const inputs: WindowGeometry[] = [
      { x: 0, y: 0, width: 600, height: 400 },
      { x: -300, y: 50, width: 1200, height: 800 },
      { x: 11, y: 22, width: 1024, height: 768 },
      { x: 1, y: 1, width: 601, height: 401 },
    ];

    for (const g of inputs) {
      expect(physicalToLogical(g, 1), `physicalToLogical identity for ${fmt(g)}`).toEqual(g);
      expect(logicalToPhysical(g, 1), `logicalToPhysical identity for ${fmt(g)}`).toEqual(g);
    }
  });

  // WI2-D — fractional scale returns integers, and the documented rounding rule
  // (Math.round, half-up) is asserted explicitly, never inferred from WI2-A.
  it("WI2-D pins the Math.round rounding rule at fractional scale factors", () => {
    // 101 * 1.5 = 151.5 -> 152 ; 601 * 1.5 = 901.5 -> 902 ; 401 * 1.5 = 601.5 -> 602
    const up15 = logicalToPhysical({ x: 101, y: 101, width: 601, height: 401 }, 1.5);
    expect(up15).toEqual({ x: 152, y: 152, width: 902, height: 602 });

    // 151 / 1.5 = 100.67 -> 101 ; 901 / 1.5 = 600.67 -> 601 ; 601 / 1.5 = 400.67 -> 401
    const down15 = physicalToLogical({ x: 151, y: 151, width: 901, height: 601 }, 1.5);
    expect(down15).toEqual({ x: 101, y: 101, width: 601, height: 401 });

    // 101 * 1.25 = 126.25 -> 126 ; 601 * 1.25 = 751.25 -> 751 ; 401 * 1.25 = 501.25 -> 501
    const up125 = logicalToPhysical({ x: 101, y: 101, width: 601, height: 401 }, 1.25);
    expect(up125).toEqual({ x: 126, y: 126, width: 751, height: 501 });

    // 151 / 1.25 = 120.8 -> 121 ; 901 / 1.25 = 720.8 -> 721 ; 601 / 1.25 = 480.8 -> 481
    const down125 = physicalToLogical({ x: 151, y: 151, width: 901, height: 601 }, 1.25);
    expect(down125).toEqual({ x: 121, y: 121, width: 721, height: 481 });

    for (const r of [up15, down15, up125, down125]) {
      expect(
        Object.values(r).every(Number.isInteger),
        `non-integer field in ${fmt(r)}`,
      ).toBe(true);
    }
  });

  // WI2-E — guard (S3): the degenerate scale-factor class.
  // Chosen policy, stated in the module doc comment: fall back to scaleFactor 1
  // and return the geometry unchanged. Never throw, never NaN/Infinity.
  it("WI2-E falls back to scaleFactor 1 for every degenerate scale factor", () => {
    const g: WindowGeometry = { x: 100, y: 100, width: 1200, height: 800 };
    const degenerate = [0, -1, -2.5, NaN, undefined, null, Infinity];

    for (const bad of degenerate) {
      const down = physicalToLogical(g, bad as unknown as number);
      const up = logicalToPhysical(g, bad as unknown as number);

      expect(down, `physicalToLogical fallback for scaleFactor=${String(bad)}`).toEqual(g);
      expect(up, `logicalToPhysical fallback for scaleFactor=${String(bad)}`).toEqual(g);

      for (const r of [down, up]) {
        expect(
          Object.values(r).every(Number.isFinite),
          `non-finite field for scaleFactor=${String(bad)} in ${fmt(r)}`,
        ).toBe(true);
        expect(
          Object.values(r).every(Number.isInteger),
          `non-integer field for scaleFactor=${String(bad)} in ${fmt(r)}`,
        ).toBe(true);
      }
    }
  });
});

describe("windowGeometry — clampToWorkArea", () => {
  // WI2-F — Law (S5): idempotence, the conditional containment invariant, and integrality.
  it("WI2-F is idempotent, contained when a fit exists, and always integral", () => {
    const geometries: WindowGeometry[] = [
      { x: 200, y: 200, width: 2400, height: 1600 },
      { x: 100, y: 100, width: 1200, height: 800 },
      { x: -500, y: -200, width: 1200, height: 800 },
      { x: 5000, y: 5000, width: 800, height: 600 },
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 99999, height: 99999 },
    ];
    const workAreas: WorkArea[] = [
      { x: 0, y: 0, width: 1440, height: 900 },
      { x: 0, y: 0, width: 1728, height: 1117 },
      { x: 1440, y: -200, width: 1920, height: 1080 },
      { x: 0, y: 0, width: 320, height: 240 },
    ];

    for (const g of geometries) {
      for (const w of workAreas) {
        const label = `g=${fmt(g)} w=${fmt(w)}`;
        const r = clampToWorkArea(g, w, MIN);

        expect(clampToWorkArea(r, w, MIN), `idempotence broken for ${label}`).toEqual(r);

        expect(r.width, `width below minSize for ${label}`).toBeGreaterThanOrEqual(MIN.width);
        expect(r.height, `height below minSize for ${label}`).toBeGreaterThanOrEqual(MIN.height);

        expect(
          Object.values(r).every(Number.isInteger),
          `non-integer field for ${label} -> ${fmt(r)}`,
        ).toBe(true);

        const fits = w.width >= MIN.width && w.height >= MIN.height;
        if (fits) {
          expect(r.x, `left edge escaped for ${label} -> ${fmt(r)}`).toBeGreaterThanOrEqual(w.x);
          expect(r.y, `top edge escaped for ${label} -> ${fmt(r)}`).toBeGreaterThanOrEqual(w.y);
          expect(r.x + r.width, `right edge escaped for ${label} -> ${fmt(r)}`).toBeLessThanOrEqual(
            w.x + w.width,
          );
          expect(
            r.y + r.height,
            `bottom edge escaped for ${label} -> ${fmt(r)}`,
          ).toBeLessThanOrEqual(w.y + w.height);
        } else {
          // Containment is deliberately not asserted here: the work area is
          // smaller than minSize, so no contained rectangle exists. WI2-I owns
          // that branch.
          expect(r.width, `minSize floor lost for ${label}`).toBe(MIN.width);
          expect(r.height, `minSize floor lost for ${label}`).toBe(MIN.height);
        }
      }
    }
  });

  // WI2-G — an already-fitting rectangle is returned unchanged, flush edges included.
  it("WI2-G returns an already-fitting rectangle unchanged, including a flush edge", () => {
    const workArea: WorkArea = { x: 0, y: 0, width: 1440, height: 900 };
    const fitting: WindowGeometry[] = [
      { x: 0, y: 0, width: 1200, height: 800 },
      { x: 100, y: 50, width: 800, height: 600 },
      // Right edge is exactly 1440 and bottom edge exactly 900 — `<=`, not `<`.
      { x: 240, y: 100, width: 1200, height: 800 },
    ];

    for (const g of fitting) {
      expect(clampToWorkArea(g, workArea, MIN), `fitting rect altered: ${fmt(g)}`).toEqual(g);
    }
  });

  // WI2-H — the inflated defect witness is reduced to fit.
  it("WI2-H reduces the inflated 2400x1600 record into a 1440x900 work area", () => {
    const r = clampToWorkArea(
      { x: 200, y: 200, width: 2400, height: 1600 },
      { x: 0, y: 0, width: 1440, height: 900 },
      { width: 600, height: 400 },
    );

    expect(r.width, "width exceeds work area").toBeLessThanOrEqual(1440);
    expect(r.height, "height exceeds work area").toBeLessThanOrEqual(900);
    expect(r.width, "width below minSize").toBeGreaterThanOrEqual(600);
    expect(r.height, "height below minSize").toBeGreaterThanOrEqual(400);
    expect(r.x, "x is negative").toBeGreaterThanOrEqual(0);
    expect(r.y, "y is negative").toBeGreaterThanOrEqual(0);
    expect(r.x + r.width, "right edge escaped").toBeLessThanOrEqual(1440);
    expect(r.y + r.height, "bottom edge escaped").toBeLessThanOrEqual(900);
  });

  // WI2-I — minSize beats the work area when the two conflict.
  it("WI2-I returns minSize when the work area is smaller than minSize", () => {
    const r = clampToWorkArea(
      { x: 0, y: 0, width: 1200, height: 800 },
      { x: 0, y: 0, width: 320, height: 240 },
      { width: 600, height: 400 },
    );

    expect(r.width).toBe(600);
    expect(r.height).toBe(400);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  // WI2-J — the minSize *parameter* is read, not a module-level constant.
  it("WI2-J honours the minSize parameter rather than a hardcoded 600x400", () => {
    const g: WindowGeometry = { x: 0, y: 0, width: 600, height: 400 };
    const w: WorkArea = { x: 0, y: 0, width: 1440, height: 900 };

    // 1. A larger floor grows the rectangle. Direction of growth is the
    //    implementer's choice; the floor is not.
    const grown = clampToWorkArea(g, w, { width: 800, height: 600 });
    expect(grown.width, "800-wide floor ignored").toBeGreaterThanOrEqual(800);
    expect(grown.height, "600-tall floor ignored").toBeGreaterThanOrEqual(600);
    expect(grown.x).toBeGreaterThanOrEqual(w.x);
    expect(grown.y).toBeGreaterThanOrEqual(w.y);
    expect(grown.x + grown.width).toBeLessThanOrEqual(w.x + w.width);
    expect(grown.y + grown.height).toBeLessThanOrEqual(w.y + w.height);
    expect(
      Object.values(grown).every(Number.isInteger),
      `non-integer field in ${fmt(grown)}`,
    ).toBe(true);

    // 2. A smaller floor does not touch a rectangle already above it.
    expect(clampToWorkArea(g, w, { width: 320, height: 240 })).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });

    // 3. The default floor is exactly satisfied — `>=`, not `>`.
    expect(clampToWorkArea(g, w, { width: 600, height: 400 })).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
  });

  // WI2-K (added while implementing, not in the matrix): the omitted-argument
  // branch. WI2-J proves the parameter is read; nothing there exercises the
  // default, and WI-3 will call this function without a minSize.
  it("WI2-K applies a 600x400 floor when minSize is omitted", () => {
    const w: WorkArea = { x: 0, y: 0, width: 1440, height: 900 };

    // Below the default floor in both axes — the default must grow it.
    const grown = clampToWorkArea({ x: 0, y: 0, width: 320, height: 240 }, w);
    expect(grown.width).toBe(600);
    expect(grown.height).toBe(400);

    // Already above the default floor — untouched.
    expect(clampToWorkArea({ x: 100, y: 100, width: 1200, height: 800 }, w)).toEqual({
      x: 100,
      y: 100,
      width: 1200,
      height: 800,
    });
  });
});
