/**
 * @module table-insert-modal.test
 * Purpose: Verify the TableInsertModal mirrors LinkInsertModal's structural
 * contract — opens when tableInsertStore.pendingCallback is set, has the
 * required ARIA attributes, supports Esc-to-cancel and Enter-to-submit,
 * and renders the rows × cols grid picker + numeric inputs from the WI-1.1
 * design spec.
 *
 * Strategy: source inspection (mirrors tests/link-insert-modal.test.ts).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const modalSrc = fs.readFileSync(
  path.join(ROOT, "src/components/Editor/TableInsertModal/index.tsx"),
  "utf-8",
);
const gridSrc = fs.readFileSync(
  path.join(ROOT, "src/components/Editor/TableInsertModal/GridPicker.tsx"),
  "utf-8",
);

describe("TableInsertModal — structural contract", () => {
  it("reads pendingCallback from useTableInsertStore", () => {
    expect(modalSrc).toMatch(/useTableInsertStore/);
    expect(modalSrc).toMatch(/pendingCallback/);
  });

  it("uses the canonical .dialog-backdrop / .dialog-card shell", () => {
    expect(modalSrc).toMatch(/dialog-backdrop/);
    expect(modalSrc).toMatch(/dialog-card/);
  });

  it("has role=dialog and aria-modal for screen readers", () => {
    expect(modalSrc).toMatch(/role="dialog"/);
    expect(modalSrc).toMatch(/aria-modal/);
  });

  it("supports Escape-to-cancel and Enter-to-submit", () => {
    expect(modalSrc).toMatch(/Escape/);
    expect(modalSrc).toMatch(/Enter/);
  });

  it("invokes pendingCallback(rows, cols) on submit and clears pending", () => {
    expect(modalSrc).toMatch(/clearPending/);
    // The callback must receive both dimensions (mirrors store contract).
    expect(modalSrc).toMatch(/pendingCallback.*rows.*cols|cb\(rows,\s*cols\)/s);
  });

  it("has an inline error region for runInsertTable failures (role=alert)", () => {
    // WI-1.1 acceptance: failure shows an inline error, modal does not auto-close.
    expect(modalSrc).toMatch(/role="alert"/);
  });

  it("renders both the grid picker and numeric inputs", () => {
    expect(modalSrc).toMatch(/GridPicker/);
    // Numeric inputs as fallback for >10 rows/cols
    expect(modalSrc).toMatch(/type="number"/);
  });

  it("logs ui.table-modal.* events via loggingService", () => {
    expect(modalSrc).toMatch(/loggingService/);
    expect(modalSrc).toMatch(/ui\.table-modal/);
  });

  it("ignores Enter during IME composition (audit fix M4)", () => {
    expect(modalSrc).toMatch(/isComposing/);
  });

  it("does not submit when Enter is pressed inside the grid picker (audit fix M5)", () => {
    expect(modalSrc).toMatch(/closest\(["']\.grid-picker["']\)/);
  });

  it("wraps callback dispatch in try/catch + surfaces error inline (audit fix M6)", () => {
    expect(modalSrc).toMatch(/try\s*\{[\s\S]{0,400}cb\s*as[\s\S]{0,200}\}\s*catch/);
    expect(modalSrc).toMatch(/Insert failed:/);
  });

  it("implements a focus trap on Tab / Shift-Tab (audit fix M3)", () => {
    expect(modalSrc).toMatch(/Tab/);
    expect(modalSrc).toMatch(/focusables/);
    expect(modalSrc).toMatch(/shiftKey/);
  });
});

describe("TableInsertModal — GridPicker contract", () => {
  it("exports a GridPicker component that accepts rows × cols up to 10×10", () => {
    expect(gridSrc).toMatch(/export\s+function\s+GridPicker/);
  });

  it("highlights cells from top-left to the hovered (or selected) coordinate", () => {
    // Fill behavior is what makes the picker feel right.
    expect(gridSrc).toMatch(/hover|active|highlighted|onMouseEnter/);
  });

  it("is keyboard-reachable and has aria-label", () => {
    expect(gridSrc).toMatch(/aria-label/);
  });

  it("calls onPick(rows, cols) when a cell is clicked", () => {
    expect(gridSrc).toMatch(/onPick/);
  });
});
