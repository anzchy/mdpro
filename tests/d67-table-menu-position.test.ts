// @vitest-environment node
/**
 * D67: both table context menus clamp their position by the menu's ACTUAL
 * rendered height, through one shared pure function.
 *
 * The old clamp subtracted a constant 480 px from the viewport height. The
 * 15-item menu is taller than that, so in a 1200x800 window a right-click
 * below y~312 put the destructive group below the window bottom
 * (docs/test/20261009-d49-d58-device-check.md F4).
 *
 * Law (S4, checked over a seeded grid): for any anchor and any menu that
 * fits in the padded viewport, the clamped box lies inside the viewport
 * minus VIEWPORT_PADDING on every side; for a menu that does not fit, the
 * position is pinned at the top-left padding. The position never goes below
 * VIEWPORT_PADDING on either axis.
 */

import { describe, expect, it } from "vitest";
import {
  clampMenuPosition,
  MENU_WIDTH,
  VIEWPORT_PADDING,
} from "../src/components/Editor/TableContextMenu/menuPosition";

const PAD = 8;
const VIEWPORT = { width: 1200, height: 800 };

describe("D67 clampMenuPosition", () => {
  it("exports the shared constants", () => {
    expect(MENU_WIDTH).toBe(220);
    expect(VIEWPORT_PADDING).toBe(PAD);
  });

  it("D67-1 device repro: a 560 px menu opened at y=500 in an 800 px window keeps its bottom inside", () => {
    const pos = clampMenuPosition({ x: 300, y: 500 }, { width: 220, height: 560 }, VIEWPORT);
    expect(pos.y + 560).toBeLessThanOrEqual(800 - PAD);
    expect(pos.y).toBeGreaterThanOrEqual(PAD);
    // Pinned exactly at the lowest position that still fits.
    expect(pos.y).toBe(800 - 560 - PAD);
    expect(pos.x).toBe(300);
  });

  it("D67-2 a menu that fits below the anchor stays at the anchor", () => {
    const pos = clampMenuPosition({ x: 300, y: 100 }, { width: 220, height: 300 }, VIEWPORT);
    expect(pos).toEqual({ x: 300, y: 100 });
  });

  it("D67-2b a menu that ends exactly at the padded bottom edge is not moved", () => {
    const pos = clampMenuPosition({ x: 300, y: 232 }, { width: 220, height: 560 }, VIEWPORT);
    expect(pos.y).toBe(232);
  });

  it("D67-3 a menu taller than the viewport pins to the top padding", () => {
    const pos = clampMenuPosition(
      { x: 300, y: 250 },
      { width: 220, height: 560 },
      { width: 1200, height: 400 },
    );
    expect(pos.y).toBe(PAD);
  });

  it("D67-4 horizontal: near the right edge it shifts left, near the left edge it stays inside", () => {
    const right = clampMenuPosition({ x: 1150, y: 100 }, { width: 220, height: 300 }, VIEWPORT);
    expect(right.x + 220).toBeLessThanOrEqual(1200 - PAD);
    expect(right.x).toBe(1200 - 220 - PAD);

    const left = clampMenuPosition({ x: 2, y: 100 }, { width: 220, height: 300 }, VIEWPORT);
    expect(left.x).toBe(PAD);
  });

  it("D67-5 a tiny viewport never yields a negative position", () => {
    const pos = clampMenuPosition(
      { x: 50, y: 50 },
      { width: 220, height: 560 },
      { width: 100, height: 100 },
    );
    expect(pos).toEqual({ x: PAD, y: PAD });
  });

  it("D67-6 (S4) the box stays inside the padded viewport across a grid of inputs", () => {
    const failures: string[] = [];
    for (const vh of [200, 480, 600, 800, 1080]) {
      for (const vw of [150, 600, 1200]) {
        for (const h of [0, 120, 480, 560, 900]) {
          for (const ay of [-20, 0, 7, 100, 312, 500, 799, 2000]) {
            for (const ax of [-5, 0, 300, 1150, 5000]) {
              const { x, y } = clampMenuPosition(
                { x: ax, y: ay },
                { width: 220, height: h },
                { width: vw, height: vh },
              );
              const tag = `vw=${vw} vh=${vh} h=${h} a=(${ax},${ay}) -> (${x},${y})`;
              if (x < PAD || y < PAD) failures.push(`below padding: ${tag}`);
              const fitsV = h <= vh - 2 * PAD;
              if (fitsV && y + h > vh - PAD) failures.push(`bottom clipped: ${tag}`);
              if (!fitsV && y !== PAD) failures.push(`tall not pinned: ${tag}`);
              const fitsH = 220 <= vw - 2 * PAD;
              if (fitsH && x + 220 > vw - PAD) failures.push(`right clipped: ${tag}`);
              // Never moved further than needed: if the anchor already fits, keep it.
              if (fitsV && ay >= PAD && ay + h <= vh - PAD && y !== ay) {
                failures.push(`moved a fitting anchor: ${tag}`);
              }
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
