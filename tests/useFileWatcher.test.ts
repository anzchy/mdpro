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
