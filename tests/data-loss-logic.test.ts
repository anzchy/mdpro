/**
 * WI-0.2 — Data-loss logic coverage (Typora-parity Phase 0).
 *
 * Covers the two highest data-loss-risk interactions via the project's
 * established source-contract pattern (precedents: useFileWatcher.test.ts,
 * useAutoSave.test.ts) — `@testing-library/react` is not available, so we
 * assert on the wired logic in `App.tsx` / `useFileWatcher.ts`:
 *
 *   1. Unsaved-changes → window close (Quit): a dirty document must trigger a
 *      confirm prompt, never a silent discard; Cancel aborts the close; only
 *      after explicit confirm is the close allowed.
 *   2. External-edit conflict: an external modification surfaces a reload
 *      dialog; in-editor unsaved content is NOT auto-clobbered (reload is
 *      user-initiated), and post-save events are suppressed.
 *
 * [→E2E BLOCKED] The real-window WKWebView path (actual Cmd-Q, native
 * onCloseRequested round-trip, real notify(2) filesystem event) requires the
 * harness in docs/plans/20260610-plan-e2e-verify-skill.md (APPROVED, unbuilt —
 * no `playwright` dep, no `tests/e2e/`). Those two end-to-end cases are marked
 * blocked below and asserted only at the logic level here.
 */
import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

/**
 * D16 WI-6 moved the OS window-close guard out of `App.tsx` and into
 * `src/hooks/useWindowCloseGuard.ts` (the effect leaked a close handler on every
 * edit). These are source-text contracts on the *App close path*, not on a
 * filename, so the pointer follows the code: App.tsx first, then the hook it now
 * delegates the guard to. No assertion below was weakened to accommodate the
 * move — the slices still start inside App.tsx.
 */
const APP_SRC = [
  fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf-8"),
  fs.readFileSync(path.resolve(__dirname, "../src/hooks/useWindowCloseGuard.ts"), "utf-8"),
].join("\n");
const WATCHER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/hooks/useFileWatcher.ts"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// 1. Unsaved-changes → Quit / window close
// ---------------------------------------------------------------------------

describe("data-loss: unsaved-changes → window close", () => {
  it("intercepts the OS close request before the window closes", () => {
    expect(APP_SRC).toMatch(/onCloseRequested/);
    // The handler must call preventDefault so the window cannot close out from
    // under a dirty document.
    expect(APP_SRC).toMatch(/event\.preventDefault\(\)/);
  });

  it("only bypasses the guard after an explicit confirm (allowWindowClose latch)", () => {
    // The latch is set true only in handleConfirmClose; the close handler
    // returns early on the "allow" decision, then resets it. Without this
    // two-step the window could close before the prompt resolves. The decision
    // itself is exercised behaviorally in data-loss-behavior.test.ts.
    expect(APP_SRC).toMatch(/allowWindowCloseRef\.current/);
    expect(APP_SRC).toMatch(/if\s*\(\s*decision\s*===\s*["']allow["']\s*\)/);
  });

  it("shows the confirm prompt (not a silent close) when there are unsaved changes", () => {
    // decideWindowClose returns "prompt" for a dirty doc; that branch opens the
    // dialog rather than closing. (Behavior asserted in data-loss-behavior.test.ts.)
    // D16 WI-6: the close path now calls the ONE shared exit entry point
    // (`windowCloseDecisionAfterFlush`, ADR-0025) instead of composing
    // `decideWindowClose` itself. Same decision, one call site for all three
    // exit paths.
    expect(APP_SRC).toMatch(/windowCloseDecisionAfterFlush\(/);
    expect(APP_SRC).toMatch(/if\s*\(\s*decision\s*===\s*["']prompt["']\s*\)/);
    expect(APP_SRC).toMatch(/setPendingClose\(\s*["']window["']\s*\)/);
  });

  it("renders a styled ConfirmDialog for unsaved changes (rule 30: no window.confirm)", () => {
    expect(APP_SRC).toMatch(/ConfirmDialog/);
    expect(APP_SRC).toMatch(/unsaved changes/i);
    // Guardrail: must not regress to the unreliable native confirm.
    expect(APP_SRC).not.toMatch(/window\.confirm\(/);
  });

  it("Cancel aborts the close without discarding (handleCancelClose clears pending state only)", () => {
    const cancel = APP_SRC.slice(APP_SRC.indexOf("handleCancelClose"));
    expect(cancel).toMatch(/setPendingClose\(\s*null\s*\)/);
    expect(cancel).toMatch(/closeTargetRef\.current\s*=\s*null/);
    // Cancel must NOT call close() — aborting means the window stays open.
    const cancelBody = cancel.slice(0, cancel.indexOf("};"));
    expect(cancelBody).not.toMatch(/\.close\(\)/);
  });

  it("Discard/Confirm proceeds: confirm latches allowWindowClose then closes", () => {
    const confirm = APP_SRC.slice(APP_SRC.indexOf("handleConfirmClose"));
    expect(confirm).toMatch(/allowWindowCloseRef\.current\s*=\s*true/);
    expect(confirm).toMatch(/\.close\(\)/);
  });

  // [→E2E BLOCKED] Real Cmd-Q on a dirty window must show the native-backed
  // dialog and keep the file untouched until the user chooses. Verified at the
  // logic level above; the real-window assertion waits on the e2e-verify harness.
  it.todo(
    "[→E2E BLOCKED] real Cmd-Q on a dirty window prompts and preserves the file (needs e2e-verify harness)",
  );
});

// ---------------------------------------------------------------------------
// 2. External-edit conflict
// ---------------------------------------------------------------------------

describe("data-loss: external-edit conflict", () => {
  it("surfaces a reload dialog on external modification (does not auto-reload)", () => {
    // The effect routes through decideFileChange and sets a reload message; it
    // must NOT call reloadFile directly, which would clobber in-editor unsaved
    // edits without asking. (Behavior asserted in data-loss-behavior.test.ts.)
    const effect = APP_SRC.slice(APP_SRC.indexOf("const decision = decideFileChange("));
    expect(effect).toMatch(/setReloadMessage\(/);
    const effectBody = effect.slice(0, effect.indexOf("}, ["));
    expect(effectBody).not.toMatch(/reloadFile\(/);
  });

  it("reload is user-initiated only (handleReloadFile is the sole reloadFile caller)", () => {
    expect(APP_SRC).toMatch(/handleReloadFile/);
    expect(APP_SRC).toMatch(/fileService\.reloadFile\(/);
    // Exactly one call site for the clobbering reload.
    const matches = APP_SRC.match(/fileService\.reloadFile\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("ignoring the reload keeps the in-editor content (clears event, no replace)", () => {
    const ignore = APP_SRC.slice(APP_SRC.indexOf("handleIgnoreReload"));
    const ignoreBody = ignore.slice(0, ignore.indexOf("}, ["));
    expect(ignoreBody).toMatch(/clearEvent\(\)/);
    expect(ignoreBody).not.toMatch(/replaceDocument\(/);
    expect(ignoreBody).not.toMatch(/reloadFile\(/);
  });

  it("suppresses self-inflicted change events within the save window", () => {
    // Without this, our own save would fire a spurious external-change reload
    // dialog and risk clobbering the just-saved content.
    expect(WATCHER_SRC).toMatch(/SAVE_SUPPRESS_WINDOW_MS/);
    expect(WATCHER_SRC).toMatch(/timeSinceSave\s*<\s*SAVE_SUPPRESS_WINDOW_MS/);
  });

  it("filters change events to the active document only", () => {
    expect(WATCHER_SRC).toMatch(/payload\.path\s*!==\s*activePath/);
  });

  // [→E2E BLOCKED] A real notify(2) filesystem event on the open file must raise
  // the dialog in a live window and leave unsaved edits intact until reload.
  it.todo(
    "[→E2E BLOCKED] real external edit raises the reload dialog and preserves unsaved edits (needs e2e-verify harness)",
  );
});

// ---------------------------------------------------------------------------
// 3. D15 WI-3 — close helpers flush pending WYSIWYG edits before deciding
// ---------------------------------------------------------------------------

describe("D15 WI-3 — App close handlers read flushed store state, not render state", () => {
  it("onCloseRequested decides on the flushed any-document-modified state", () => {
    // D16 WI-6: `windowCloseDecisionAfterFlush` IS flush-then-read — it calls
    // `assessWindowUnsaved("window-close")` and reports every modified document,
    // so this pins the same "decide on flushed state, never on render state"
    // property that `hasUnsavedChanges: hasUnsavedChangesAfterFlush()` pinned
    // before the guard moved into the hook, plus the latch it is passed.
    expect(APP_SRC).toMatch(/windowCloseDecisionAfterFlush\(\{\s*allowWindowClose:/);
    expect(APP_SRC).not.toMatch(/hasUnsavedRef/);
  });

  it("handleCloseRequest decides on the flushed active document", () => {
    expect(APP_SRC).toMatch(/decideCloseRequest\(\s*activeDocumentAfterFlush\(\)\s*\)/);
    expect(APP_SRC).not.toMatch(/decideCloseRequest\(\s*activeDocument\s*\)/);
  });
});
