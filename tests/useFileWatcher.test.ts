/**
 * Tests for useFileWatcher hook logic.
 *
 * Since @testing-library/react is not available, we verify the hook's
 * source contract via static analysis: cleanup, path filtering,
 * save-suppression, and event structure.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_PATH = path.resolve(__dirname, "../src/hooks/useFileWatcher.ts");
const src = fs.readFileSync(SRC_PATH, "utf-8");

describe("useFileWatcher — source contract", () => {
  it("listens for file:changed events", () => {
    expect(src).toMatch(/listen.*["']file:changed["']/);
  });

  it("filters events by activePath", () => {
    expect(src).toMatch(/payload\.path\s*!==\s*activePath/);
  });

  it("cleans up listener on unmount (calls unlisten)", () => {
    expect(src).toMatch(/unlistenFn\?\.\(\)/);
  });

  it("handles cancelled state for race conditions", () => {
    expect(src).toMatch(/cancelled/);
    // Verify cancelled is set in cleanup
    expect(src).toMatch(/cancelled\s*=\s*true/);
  });

  it("suppresses events within save window", () => {
    expect(src).toMatch(/SAVE_SUPPRESS_WINDOW_MS/);
    expect(src).toMatch(/timeSinceSave\s*<\s*SAVE_SUPPRESS_WINDOW_MS/);
  });

  it("exports markSaveInProgress for save coordination", () => {
    expect(src).toMatch(/markSaveInProgress/);
  });

  it("exports clearEvent to reset event state", () => {
    expect(src).toMatch(/clearEvent/);
  });

  it("returns early when activePath is null", () => {
    expect(src).toMatch(/if\s*\(\s*!activePath\s*\)\s*return/);
  });

  it("depends on activePath in useEffect", () => {
    expect(src).toMatch(/\[activePath\]/);
  });
});

describe("useFileWatcher — debounce (regression for #211)", () => {
  it("defines the debounce interval as a named constant, not a magic number", () => {
    expect(src).toMatch(/const\s+FRONTEND_DEBOUNCE_MS\s*=\s*\d+/);
  });

  it("coalesces bursts by clearing the pending timer before scheduling a new one", () => {
    // Without this clear, every event would fire its own setEvent (the #211 flicker).
    expect(src).toMatch(
      /if\s*\(\s*debounceTimerRef\.current\s*\)\s*clearTimeout\(\s*debounceTimerRef\.current\s*\)/,
    );
  });

  it("emits the event through a debounced setTimeout, not synchronously", () => {
    // setEvent must be inside a setTimeout(..., FRONTEND_DEBOUNCE_MS), so only the
    // trailing event of a burst reaches state.
    expect(src).toMatch(
      /setTimeout\(\s*\(\)\s*=>\s*\{\s*setEvent\(payload\.payload\)/,
    );
    expect(src).toMatch(/\}\s*,\s*FRONTEND_DEBOUNCE_MS\s*\)/);
  });

  it("clears the pending debounce timer on cleanup to avoid setState after unmount", () => {
    const cleanup = src.slice(src.indexOf("return () =>"));
    expect(cleanup).toMatch(/clearTimeout\(\s*debounceTimerRef\.current\s*\)/);
  });
});

describe("useFileWatcher — FileChangedEvent type", () => {
  it("exports FileChangedEvent interface with required fields", () => {
    expect(src).toMatch(/path:\s*string/);
    expect(src).toMatch(/changeType:\s*["']modified["']/);
    expect(src).toMatch(/timestamp:\s*number/);
  });

  it("supports optional newPath for rename events", () => {
    expect(src).toMatch(/newPath\?\s*:\s*string/);
  });
});
