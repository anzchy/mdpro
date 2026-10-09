// @vitest-environment node
/**
 * Tests for issue #13 — a11y focus order fixes.
 *
 * 1. DevToolbar's hidden file input must stay out of the tab order so
 *    keyboard-only users are not routed through a dev hook before reaching
 *    the editor.
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
// DevToolbar — its hidden file input must be excluded from tab order
// ---------------------------------------------------------------------------

describe("DevToolbar tab order", () => {
  const code = stripComments(readComponent("components/DevToolbar.tsx"));

  // The visible <div className="dev-toolbar"> container (and its tabIndex={-1})
  // no longer exists: by user decision 2026-10-05 (plan-20261005-devtoolbar WI-2)
  // browser dev mode mounts only a hidden file input. The keyboard-order
  // guarantee now has to hold on that input instead.
  it("renders no .dev-toolbar container", () => {
    expect(code).not.toMatch(/className="dev-toolbar/);
  });

  it("the dev-open-file input is hidden and has tabIndex={-1}", () => {
    const input = code.match(/<input[\s\S]*?\/>/)?.[0] ?? "";
    expect(input).toMatch(/data-testid="dev-open-file"/);
    expect(input).toMatch(/\bhidden\b/);
    expect(input).toMatch(/tabIndex=\{-1\}/);
  });
});

/** Remove block and line comments so header prose can neither satisfy nor trip a match. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ---------------------------------------------------------------------------
// ConfirmDialog — must handle Escape to close
// ---------------------------------------------------------------------------

describe("ConfirmDialog keyboard accessibility", () => {
  const src = readComponent("components/common/ConfirmDialog.tsx");
  const code = stripComments(src);

  // D34 (policy rule 12, changed assertion with a stated reason): the two matches this
  // replaces — `/onKeyDown/` + `/Escape/`, and `/Escape[\s\S]{0,200}onCancel/` — certified the
  // card/backdrop-level `onKeyDown` mechanism, which D34 showed does not fire when focus is
  // outside the backdrop. Escape now goes through the shared `useDialogEscape` stack, and its
  // behaviour is specified by `tests/confirm-dialog.test.tsx` (CD-1 … CD-10).
  it("FT-D34-1: registers Escape through useDialogEscape with the cancel handler", () => {
    expect(code).toMatch(/useDialogEscape\(\s*\{[\s\S]{0,300}onEscape:\s*handleCancel/);
  });

  // D34 moved Escape to `useDialogEscape`; a second mechanism is invisible to behaviour tests
  // (the capture-phase stack consumes the key first), so only a source check can catch it.
  // If ConfirmDialog later gains a Tab-trap `onKeyDown` (rule 32), drop the `onKeyDown` half
  // with that stated reason and keep the Escape-literal half.
  it("FT-D34-1b: has no residual Escape literal and no onKeyDown", () => {
    expect(code).not.toMatch(/["'`]Escape["'`]/);
    expect(code).not.toMatch(/onKeyDown/);
  });

  // D53 (policy rule 12, changed assertion with a stated reason): the assertion this replaces —
  // `expect(src).toMatch(/autoFocus/)` — certified React `autoFocus` as the initial-focus
  // mechanism. autoFocus focuses before mount effects run, and WebKit ignores `focusVisible` on
  // an element that already has focus, so a later visible-focus request would be a no-op and the
  // rule 33 pattern 2 ring never shows on device. Initial focus is now one
  // `focus({ focusVisible: true })` call; its behaviour (target, options, exactly once per open)
  // is specified by `tests/confirm-dialog.test.tsx` CD-14 … CD-17. Checked on comment-stripped
  // `code` so header prose can neither satisfy nor trip it.
  it("FT-D53-1: requests visible initial focus and does not use autoFocus", () => {
    expect(code).toMatch(/focusVisible:\s*true/);
    expect(code).not.toMatch(/autoFocus/);
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
  const code = stripComments(src);
  const buttons = src.split("<button").slice(1).map((chunk) => chunk.split("</button>")[0]);

  // D34 (policy rule 12, changed assertion with a stated reason): the match this replaces —
  // `/Escape[\s\S]{0,200}onReject/` on the raw source — certified the card-level `onKeyDown`
  // Escape branch, which D34 showed does not fire when focus is outside the card; the header
  // prose alone would also satisfy it. Escape now goes through the shared `useDialogEscape`
  // stack, and its behaviour is specified by D-8 … D-12, CT-3 … CT-6 and ES-1 … ES-4.
  it("FT-D34-2: registers Escape through useDialogEscape with onReject", () => {
    expect(code).toMatch(/useDialogEscape\(\s*\{[\s\S]{0,300}onEscape:\s*onReject/);
  });

  // D34 moved Escape to `useDialogEscape`; a leftover Escape branch in `handleKeyDown` is
  // invisible to behaviour tests (the capture-phase stack consumes the key first), so only a
  // source check can catch it. No `onKeyDown` check: the Tab wrap (rule 32) keeps one, and
  // existing D-4 guards it behaviourally.
  it("FT-D34-2b: has no residual Escape literal", () => {
    expect(code).not.toMatch(/["'`]Escape["'`]/);
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
