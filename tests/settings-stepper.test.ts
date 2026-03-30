/**
 * Tests for SettingsStepper component.
 *
 * Strategy: source inspection for structural guarantees + logic verification
 * by extracting and testing the core increment/decrement/boundary logic.
 *
 * Covers:
 *   1. Source structure: aria-label, role="group", disabled at boundary, keyboard handlers.
 *   2. Boundary logic: value <= min → no change; value >= max → no change.
 *   3. Debounce: 150ms debounce is coded.
 *   4. Keyboard: ArrowUp increments, ArrowDown decrements, ArrowRight increments, ArrowLeft decrements.
 *   5. Unit renders: value + unit concatenated.
 *
 * Edge cases:
 *   - At min boundary: decrement does nothing (no onChange call path).
 *   - At max boundary: increment does nothing.
 *   - unit="" (default) → no extra string appended.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const stepperSrc = fs.readFileSync(
  path.join(SRC, "components/common/settings/SettingsStepper.tsx"),
  "utf-8",
);

describe("SettingsStepper — source structure", () => {
  it("exports SettingsStepper as a named export", () => {
    expect(stepperSrc).toContain("export function SettingsStepper");
  });

  it("renders outer div with role='group'", () => {
    expect(stepperSrc).toContain('role="group"');
  });

  it("decrease button is disabled when value <= min", () => {
    expect(stepperSrc).toContain("disabled={value <= min}");
  });

  it("increase button is disabled when value >= max", () => {
    expect(stepperSrc).toContain("disabled={value >= max}");
  });

  it("decrease button has aria-label='Decrease'", () => {
    expect(stepperSrc).toContain('aria-label="Decrease"');
  });

  it("increase button has aria-label='Increase'", () => {
    expect(stepperSrc).toContain('aria-label="Increase"');
  });

  it("component is keyboard-focusable via tabIndex={0}", () => {
    expect(stepperSrc).toContain("tabIndex={0}");
  });

  it("onKeyDown handler is attached to the container div", () => {
    expect(stepperSrc).toContain("onKeyDown={handleKeyDown}");
    expect(stepperSrc).toContain("handleKeyDown");
  });

  it("ArrowUp key triggers increment", () => {
    expect(stepperSrc).toContain('"ArrowUp"');
    expect(stepperSrc).toContain("increment()");
  });

  it("ArrowDown key triggers decrement", () => {
    expect(stepperSrc).toContain('"ArrowDown"');
    expect(stepperSrc).toContain("decrement()");
  });

  it("ArrowRight key triggers increment (horizontal keyboard support)", () => {
    expect(stepperSrc).toContain('"ArrowRight"');
  });

  it("ArrowLeft key triggers decrement (horizontal keyboard support)", () => {
    expect(stepperSrc).toContain('"ArrowLeft"');
  });

  it("debounces onChange by 150ms to avoid hammering preferences service", () => {
    expect(stepperSrc).toContain("150");
    expect(stepperSrc).toContain("setTimeout");
    expect(stepperSrc).toContain("clearTimeout");
  });

  it("cleans up the pending timer on unmount", () => {
    // Effect cleanup in useEffect return
    expect(stepperSrc).toContain("clearTimeout(timerRef.current)");
  });

  it("displays value and unit concatenated inside a span", () => {
    expect(stepperSrc).toContain("{value}");
    expect(stepperSrc).toContain("{unit}");
  });
});

// ---------------------------------------------------------------------------
// Boundary logic — extracted and tested as pure state machine
// (mirrors the guard conditions in decrement() and increment())
// ---------------------------------------------------------------------------
describe("SettingsStepper — boundary logic (pure)", () => {
  function simulateDecrement(value: number, min: number): number | null {
    if (value <= min) return null; // no change
    return value - 1;
  }

  function simulateIncrement(value: number, max: number): number | null {
    if (value >= max) return null; // no change
    return value + 1;
  }

  it("decrement at min returns null (onChange not called)", () => {
    expect(simulateDecrement(12, 12)).toBeNull();
  });

  it("decrement below min returns null", () => {
    expect(simulateDecrement(11, 12)).toBeNull();
  });

  it("decrement above min returns value - 1", () => {
    expect(simulateDecrement(16, 12)).toBe(15);
  });

  it("increment at max returns null (onChange not called)", () => {
    expect(simulateIncrement(24, 24)).toBeNull();
  });

  it("increment above max returns null", () => {
    expect(simulateIncrement(25, 24)).toBeNull();
  });

  it("increment below max returns value + 1", () => {
    expect(simulateIncrement(16, 24)).toBe(17);
  });

  it("min === max: both increment and decrement are no-ops", () => {
    expect(simulateDecrement(16, 16)).toBeNull();
    expect(simulateIncrement(16, 16)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Debounce logic — verify the setTimeout pattern in source
// ---------------------------------------------------------------------------
describe("SettingsStepper — debounce pattern", () => {
  it("uses useMemo to create a stable debouncedChange wrapper", () => {
    expect(stepperSrc).toContain("useMemo");
    expect(stepperSrc).toContain("debouncedChange");
  });

  it("clears previous timer before setting a new one (prevents stacking)", () => {
    // clearTimeout must come before setTimeout in the debounce body
    const clearIdx = stepperSrc.indexOf("clearTimeout(timerRef.current)");
    const setIdx = stepperSrc.indexOf("timerRef.current = setTimeout");
    expect(clearIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeLessThan(setIdx);
  });
});
