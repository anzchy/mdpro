// @vitest-environment node
/**
 * @module d245-toast-width.test
 * Purpose: D245. The toast had no width cap: a save-failure toast carrying a
 * full path grew to ~730 px, and in a 400 px window its left edge left the
 * window. It now caps at `min(480px, calc(100vw - 40px))`, which with its
 * fixed `right: 20px` keeps 20 px clear on the left at any window width, and
 * its message wraps anywhere, so a path with no break points wraps instead of
 * overflowing. Rule 32: one toast, fixed at right 20px / bottom 20px (kept).
 *
 * Strategy: source inspection; jsdom has no layout, so the edge is computed
 * from the declared geometry, and the device check measures it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";

const FILE = join(__dirname, "..", "src", "styles", "sections", "recovery-toast.css");
const decls = parseDeclarations(readFileSync(FILE, "utf8"));
const rule = (selector: string) =>
  new Map(decls.filter((d) => d.selector.split(",").some((s) => s.trim() === selector)).map((d) => [d.property, d.value]));

/** Left edge of the toast box in a window `vw` wide, at its widest. */
function leftEdge(vw: number): number {
  const toast = rule(".toast");
  const right = parseFloat(toast.get("right")!);
  const max = toast.get("max-width")!;
  const m = max.match(/^min\((\d+)px,\s*calc\(100vw - (\d+)px\)\)$/);
  expect(m, `max-width "${max}"`).not.toBeNull();
  const width = Math.min(Number(m![1]), vw - Number(m![2]));
  return vw - right - width;
}

describe("D245: the toast stays inside the window", () => {
  it("keeps rule 32's fixed placement", () => {
    const t = rule(".toast");
    expect(t.get("position")).toBe("fixed");
    expect(t.get("right")).toBe("20px");
    expect(t.get("bottom")).toBe("20px");
  });

  it("caps its width at min(480px, calc(100vw - 40px))", () => {
    expect(rule(".toast").get("max-width")).toBe("min(480px, calc(100vw - 40px))");
  });

  it.each([320, 400, 520, 800, 1440])("at %ipx wide its left edge is at least 20px in", (vw) => {
    expect(leftEdge(vw)).toBeGreaterThanOrEqual(20);
  });

  it("the message can shrink and wraps an unbroken path", () => {
    const m = rule(".toast > span");
    expect(m.get("min-width")).toBe("0");
    expect(m.get("overflow-wrap")).toBe("anywhere");
  });

  it("the close button does not shrink", () => {
    expect(rule(".toast-close").get("flex-shrink")).toBe("0");
  });
});
