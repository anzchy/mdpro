// @vitest-environment node
/**
 * Tests for useFileWatcher hook logic.
 *
 * Since @testing-library/react is not available, we verify the hook's
 * source contract via static analysis: cleanup, one listener for the window's
 * lifetime (D171), no save-suppression window (D86 WI-4), and event structure.
 * The behaviour is pinned by tests/d171-*.test.tsx and the D32 logging tests.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_PATH = path.resolve(__dirname, "../src/hooks/useFileWatcher.ts");
const src = fs.readFileSync(SRC_PATH, "utf-8");
// D171: the 300 ms presentation debounce and the event type moved out of the hook.
const presenter = fs.readFileSync(path.resolve(__dirname, "../src/hooks/usePresentedFileChange.ts"), "utf-8");
const types = fs.readFileSync(path.resolve(__dirname, "../src/types/fileChange.ts"), "utf-8");

describe("useFileWatcher — source contract", () => {
  it("listens for file:changed events", () => {
    expect(src).toMatch(/listen.*["']file:changed["']/);
  });

  it("no longer filters events by activePath (D171): every event is recorded", () => {
    expect(src).not.toMatch(/payload\.path\s*!==\s*activePath/);
    expect(src).toMatch(/recordFileChange\(/);
  });

  it("cleans up listener on unmount (calls unlisten)", () => {
    expect(src).toMatch(/unlistenFn\?\.\(\)/);
  });

  it("handles cancelled state for race conditions", () => {
    expect(src).toMatch(/cancelled/);
    // Verify cancelled is set in cleanup
    expect(src).toMatch(/cancelled\s*=\s*true/);
  });

  it("has no save-suppression window: Rust recognises our own saves (D86 WI-4)", () => {
    expect(src).not.toMatch(/SAVE_SUPPRESS_WINDOW_MS/);
    expect(src).not.toMatch(/timeSinceSave/);
  });

  it("no longer exports markSaveInProgress (D86 WI-4)", () => {
    expect(src).not.toMatch(/markSaveInProgress/);
  });

  it("exports clearEvent to reset event state", () => {
    expect(src).toMatch(/clearEvent/);
  });

  it("subscribes even when no path is active (D171)", () => {
    expect(src).not.toMatch(/if\s*\(\s*!activePath\s*\)\s*return/);
  });

  it("mounts the listener once for the window's lifetime, not per active path (D171)", () => {
    expect(src).not.toMatch(/\[activePath\]/);
    expect(src).toMatch(/\}\s*,\s*\[\]\s*\);/);
  });
});

describe("useFileWatcher — debounce (regression for #211)", () => {
  it("defines the debounce interval as a named constant, not a magic number", () => {
    expect(presenter).toMatch(/const\s+PRESENTATION_DEBOUNCE_MS\s*=\s*\d+/);
  });

  it("presents through a timer measured from the latest receipt, not synchronously", () => {
    // Only the trailing change of a burst is presented (the #211 flicker).
    expect(presenter).toMatch(/receivedAt\s*\+\s*PRESENTATION_DEBOUNCE_MS/);
    expect(presenter).toMatch(/setTimeout\(\s*\(\)\s*=>\s*setPresented\(slot\)/);
  });

  it("clears the pending presentation timer on cleanup to avoid setState after unmount", () => {
    expect(presenter).toMatch(/return\s*\(\)\s*=>\s*clearTimeout\(\s*timer\s*\)/);
  });
});

describe("useFileWatcher — FileChangedEvent type", () => {
  it("exports FileChangedEvent interface with required fields", () => {
    expect(src).toMatch(/export type \{ FileChangedEvent \}/);
    expect(types).toMatch(/path:\s*string/);
    expect(types).toMatch(/changeType:\s*["']modified["']/);
    expect(types).toMatch(/timestamp:\s*number/);
  });

  it("supports optional newPath for rename events", () => {
    expect(types).toMatch(/newPath\?\s*:\s*string/);
  });
});
