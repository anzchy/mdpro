// @vitest-environment node
/**
 * D189 / ADR-0088: the sidebar width's range, its keyboard steps, and the
 * toggle button's label. Pure functions, no DOM.
 */
import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  sidebarWidthForKey,
  SIDEBAR_WIDTH_BIG_STEP,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_STEP,
} from "../src/utils/sidebarWidth";
import { sidebarToggleLabel } from "../src/utils/platformLabels";

describe("D189 sidebar width constants (ADR-0088)", () => {
  it("are the decided range, default and steps", () => {
    expect([SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX]).toEqual([180, 220, 480]);
    expect([SIDEBAR_WIDTH_STEP, SIDEBAR_WIDTH_BIG_STEP]).toEqual([8, 32]);
  });
});

describe("D189 clampSidebarWidth", () => {
  it.each([
    [180, 180],
    [300, 300],
    [480, 480],
    [179, 180],
    [-5, 180],
    [0, 180],
    [481, 480],
    [1e9, 480],
    [250.4, 250],
    [250.5, 251],
  ])("%s → %s", (raw, want) => {
    expect(clampSidebarWidth(raw)).toBe(want);
  });

  it.each([NaN, Infinity, -Infinity, "300", null, undefined, {}])(
    "%s is not a usable width and reads as the default",
    (raw) => {
      expect(clampSidebarWidth(raw)).toBe(SIDEBAR_WIDTH_DEFAULT);
    },
  );
});

describe("D189 sidebarWidthForKey", () => {
  it.each([
    ["ArrowRight", false, 220, 228],
    ["ArrowLeft", false, 220, 212],
    ["ArrowRight", true, 220, 252],
    ["ArrowLeft", true, 220, 188],
    ["Home", false, 300, 180],
    ["End", false, 300, 480],
  ])("%s (shift %s) from %s → %s, source keyboard", (key, shift, from, want) => {
    expect(sidebarWidthForKey(from, key, shift)).toEqual({ width: want, source: "keyboard" });
  });

  it("clamps a step at either end", () => {
    expect(sidebarWidthForKey(184, "ArrowLeft", false)).toEqual({ width: 180, source: "keyboard" });
    expect(sidebarWidthForKey(470, "ArrowRight", true)).toEqual({ width: 480, source: "keyboard" });
  });

  it("Enter resets to the default", () => {
    expect(sidebarWidthForKey(400, "Enter", false)).toEqual({ width: 220, source: "reset" });
  });

  it.each(["ArrowUp", "ArrowDown", "Tab", "a", " ", "Escape"])("%s is not a resize key", (key) => {
    expect(sidebarWidthForKey(300, key, false)).toBeNull();
  });
});

describe("D189 sidebarToggleLabel (ADR-0088 decision 1)", () => {
  it("names the action and the platform shortcut", () => {
    expect(sidebarToggleLabel(true, true)).toBe("Hide Sidebar (⌘⇧L)");
    expect(sidebarToggleLabel(false, true)).toBe("Show Sidebar (⌘⇧L)");
    expect(sidebarToggleLabel(true, false)).toBe("Hide Sidebar (Ctrl+Shift+L)");
    expect(sidebarToggleLabel(false, false)).toBe("Show Sidebar (Ctrl+Shift+L)");
  });
});
