/**
 * Regression test for issue #123 — window event listener leak on unmount during drag.
 *
 * SplitView adds `mousemove` and `mouseup` listeners to `window` when a drag
 * starts, and previously only removed them on `mouseup`. If the component
 * unmounts mid-drag (e.g., user switches view mode via ⌘1/⌘2/⌘3/⌘4), both
 * listeners leaked indefinitely.
 *
 * Fix: a `cleanupRef` stores the removal function and a `useEffect` calls it
 * on unmount, guaranteeing cleanup regardless of whether `mouseup` fires.
 *
 * These tests parse the component source to verify the structural fix is present,
 * following the same pattern used elsewhere in this test suite.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

describe("SplitView — drag listener cleanup on unmount (issue #123)", () => {
  const src = readComponent("components/Editor/SplitView.tsx");

  it("imports useEffect (needed for unmount cleanup)", () => {
    // The fix requires useEffect to register an unmount cleanup.
    // If only useRef/useState are imported the fix is absent.
    expect(src).toMatch(/\buseEffect\b/);
  });

  it("uses a cleanupRef to track the active drag cleanup function", () => {
    // The cleanup function must be stored in a ref so the useEffect
    // cleanup has a stable reference to call on unmount.
    expect(src).toMatch(/cleanupRef/);
  });

  it("calls cleanupRef.current on component unmount via useEffect return", () => {
    // The useEffect must return a function that invokes cleanupRef.current
    // so that unmounting during a drag removes the window listeners.
    expect(src).toMatch(/cleanupRef\.current\s*\?\.\s*\(\)/);
  });

  it("assigns the cleanup function to cleanupRef.current inside startDrag", () => {
    // startDrag must populate cleanupRef.current so the unmount hook
    // can call it.
    expect(src).toMatch(/cleanupRef\.current\s*=/);
  });

  it("clears cleanupRef.current after cleanup runs (prevents double-removal)", () => {
    // The cleanup function should null out cleanupRef.current so a
    // mouseup after unmount (possible in some browser environments) is a no-op.
    expect(src).toMatch(/cleanupRef\.current\s*=\s*null/);
  });
});
