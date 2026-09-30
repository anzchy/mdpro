/**
 * Tests for issue #13 — a11y focus order fixes.
 *
 * 1. DevToolbar must have tabIndex={-1} on its container so keyboard-only
 *    users are not routed through dev controls before reaching the editor.
 * 2. Modal dialogs must handle the Escape key to close.
 * 3. Dialogs that have no close action (RecoveryDialog) must NOT be given
 *    an Escape handler, since the user must make an explicit choice.
 *
 * These are pure logic / snapshot-free tests that verify the props/attributes
 * the components render, without requiring a full React render environment.
 * We parse the source text of each component to assert on the presence of the
 * required attributes. This keeps the tests fast and dependency-free.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// DevToolbar — must be excluded from tab order
// ---------------------------------------------------------------------------

describe("DevToolbar tab order", () => {
  const src = readComponent("components/DevToolbar.tsx");

  it("outermost container has tabIndex={-1}", () => {
    // The root <div className="dev-toolbar"> must carry tabIndex={-1} so the
    // browser skips it during sequential Tab navigation.
    expect(src).toMatch(/tabIndex=\{-1\}/);
  });
});

// ---------------------------------------------------------------------------
// ConfirmDialog — must handle Escape to close
// ---------------------------------------------------------------------------

describe("ConfirmDialog keyboard accessibility", () => {
  const src = readComponent("components/common/ConfirmDialog.tsx");

  it("has onKeyDown handler that checks for Escape key", () => {
    expect(src).toMatch(/onKeyDown/);
    expect(src).toMatch(/Escape/);
  });

  it("calls onCancel when Escape is pressed (handler wired to onCancel)", () => {
    // Verify the Escape branch invokes onCancel (or onClose alias)
    expect(src).toMatch(/Escape[\s\S]{0,200}onCancel/);
  });

  it("primary action button has autoFocus so focus lands inside dialog on open", () => {
    expect(src).toMatch(/autoFocus/);
  });
});

// ---------------------------------------------------------------------------
// SettingsDialog — must handle Escape to close
// ---------------------------------------------------------------------------

describe("SettingsDialog keyboard accessibility", () => {
  const src = readComponent("components/common/SettingsDialog.tsx");

  it("has onKeyDown handler that checks for Escape key", () => {
    expect(src).toMatch(/onKeyDown/);
    expect(src).toMatch(/Escape/);
  });

  it("calls onClose when Escape is pressed", () => {
    expect(src).toMatch(/Escape[\s\S]{0,200}onClose/);
  });
});

// ---------------------------------------------------------------------------
// ReloadDialog — must handle Escape to close (maps to onIgnore)
// ---------------------------------------------------------------------------

describe("ReloadDialog keyboard accessibility", () => {
  const src = readComponent("components/common/ReloadDialog.tsx");

  it("has onKeyDown handler that checks for Escape key", () => {
    expect(src).toMatch(/onKeyDown/);
    expect(src).toMatch(/Escape/);
  });

  it("primary action button has autoFocus", () => {
    expect(src).toMatch(/autoFocus/);
  });
});

// ---------------------------------------------------------------------------
// RecoveryDialog — must NOT add Escape (forced choice, no onClose prop)
// ---------------------------------------------------------------------------

describe("RecoveryDialog — no Escape handler (forced recovery)", () => {
  const src = readComponent("components/common/RecoveryDialog.tsx");

  it("does NOT have an onClose prop in its interface", () => {
    // RecoveryDialog forces the user to pick recover or discard.
    // It must not be dismissible via Escape.
    expect(src).not.toMatch(/onClose/);
  });
});

// ---------------------------------------------------------------------------
// McpWriteConfirmDialog — Escape rejects; initial focus on Reject (ADR-0042 FT-1)
// ---------------------------------------------------------------------------

describe("McpWriteConfirmDialog keyboard accessibility (FT-1)", () => {
  const src = readComponent("components/common/McpWriteConfirmDialog.tsx");
  const buttons = src.split("<button").slice(1).map((chunk) => chunk.split("</button>")[0]);

  it("Escape is wired to onReject", () => {
    expect(src).toMatch(/Escape[\s\S]{0,200}onReject/);
  });

  it("the Reject button carries autoFocus and the Approve button does not", () => {
    const reject = buttons.filter((b) => b.includes("onClick={onReject}"));
    const approve = buttons.filter((b) => b.includes("onClick={onApprove}"));
    expect(reject).toHaveLength(1);
    expect(approve).toHaveLength(1);
    expect(reject[0]).toMatch(/autoFocus/);
    expect(approve[0]).not.toMatch(/autoFocus/);
  });
});
