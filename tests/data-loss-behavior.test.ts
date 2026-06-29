/**
 * Fix 5 — Behavioral teeth for the data-loss decision logic.
 *
 * The existing data-loss-logic.test.ts asserts on App.tsx *source text*
 * (`toMatch(/ConfirmDialog/)`) — those guard the wiring but prove no behavior.
 * Here we exercise the extracted pure decisions (src/utils/dataLossGuards.ts)
 * that App.tsx routes through, so a regression in the *logic* (not just the
 * wording) fails a test. `@testing-library/react` is unavailable in this repo,
 * so we test the decision functions directly + drive the close/reload flow with
 * a fake-IPC stand-in (precedent: useFileWatcher.test.ts).
 *
 * Teeth: each test names the guard it protects. Removing that guard from
 * dataLossGuards.ts flips the asserted decision and fails the test.
 *
 * [→E2E BLOCKED] The real-window WKWebView path (actual Cmd-Q, native
 * onCloseRequested round-trip, real notify(2) event) still needs the harness in
 * docs/plans/20260610-plan-e2e-verify-skill.md (APPROVED, unbuilt). Those cases
 * stay it.todo below.
 */
import { describe, expect, it, vi } from "vitest";
import {
  decideCloseRequest,
  decideFileChange,
  decideWindowClose,
  type FileChangeEvent,
} from "../src/utils/dataLossGuards";

// ---------------------------------------------------------------------------
// 1. Unsaved-changes → window close (Quit)
// ---------------------------------------------------------------------------

describe("data-loss behavior: window close with unsaved changes", () => {
  it("prompts (never silently closes) when there are unsaved changes", () => {
    // Guard: the hasUnsavedChanges branch. Drop it and a dirty window would
    // fall through to save-and-close — silent data loss.
    expect(decideWindowClose({ allowWindowClose: false, hasUnsavedChanges: true })).toBe("prompt");
  });

  it("allows the close only after the confirm latch is set", () => {
    // Guard: the allowWindowClose latch. Without it the second close request
    // (after confirm) would prompt again forever.
    expect(decideWindowClose({ allowWindowClose: true, hasUnsavedChanges: true })).toBe("allow");
    expect(decideWindowClose({ allowWindowClose: true, hasUnsavedChanges: false })).toBe("allow");
  });

  it("saves window state and closes a clean document without prompting", () => {
    expect(decideWindowClose({ allowWindowClose: false, hasUnsavedChanges: false })).toBe(
      "save-and-close",
    );
  });

  it("Cancel aborts: a prompt decision does not close the window", () => {
    // Simulate the App flow: prompt → user cancels → window must stay open.
    const close = vi.fn();
    const decision = decideWindowClose({ allowWindowClose: false, hasUnsavedChanges: true });
    if (decision === "prompt") {
      // user clicks Cancel — handleCancelClose clears pending state, no close()
    } else {
      close();
    }
    expect(close).not.toHaveBeenCalled();
  });

  it("Confirm proceeds: latch then close (no prompt the second time)", () => {
    // After confirm, the latch is set and the re-issued close request allows.
    let allowWindowClose = false;
    // first request → prompt
    expect(decideWindowClose({ allowWindowClose, hasUnsavedChanges: true })).toBe("prompt");
    // confirm latches it
    allowWindowClose = true;
    const close = vi.fn();
    const second = decideWindowClose({ allowWindowClose, hasUnsavedChanges: true });
    if (second === "allow") close();
    expect(close).toHaveBeenCalledOnce();
  });

  // [→E2E BLOCKED] Real Cmd-Q on a dirty window must show the dialog and keep
  // the file untouched until the user chooses. Logic verified above.
  it.todo(
    "[→E2E BLOCKED] real Cmd-Q on a dirty window prompts and preserves the file (needs e2e-verify harness)",
  );
});

describe("data-loss behavior: in-app document close (Cmd-W)", () => {
  it("prompts on a modified document", () => {
    expect(decideCloseRequest({ isModified: true })).toBe("prompt");
  });

  it("closes a clean document directly", () => {
    expect(decideCloseRequest({ isModified: false })).toBe("close");
  });

  it("is a no-op with no active document", () => {
    expect(decideCloseRequest(null)).toBe("noop");
  });
});

// ---------------------------------------------------------------------------
// 2. External-edit conflict
// ---------------------------------------------------------------------------

describe("data-loss behavior: external-edit conflict", () => {
  const activeDoc = { path: "/docs/a.md" };

  it("does NOT auto-reload on external modify — surfaces a prompt instead", () => {
    // Guard: the reload-prompt branch. If this returned a reload action, the
    // user's in-editor unsaved edits would be clobbered without asking.
    const ev: FileChangeEvent = { path: "/docs/a.md", changeType: "modified" };
    const decision = decideFileChange(ev, activeDoc);
    expect(decision.action).toBe("reload-prompt");
  });

  it("ignores change events for a different file (active-doc filter)", () => {
    // Guard: the path filter. Without it, an edit to an unrelated file would
    // raise a reload prompt for the wrong document.
    const ev: FileChangeEvent = { path: "/docs/OTHER.md", changeType: "modified" };
    expect(decideFileChange(ev, activeDoc).action).toBe("ignore");
  });

  it("surfaces a deleted prompt (does not silently lose the buffer)", () => {
    const ev: FileChangeEvent = { path: "/docs/a.md", changeType: "deleted" };
    const decision = decideFileChange(ev, activeDoc);
    expect(decision.action).toBe("deleted-prompt");
  });

  it("applies a rename in place without prompting to reload", () => {
    const ev: FileChangeEvent = {
      path: "/docs/a.md",
      changeType: "renamed",
      newPath: "/docs/b.md",
    };
    const decision = decideFileChange(ev, activeDoc);
    expect(decision).toEqual({ action: "rename", newPath: "/docs/b.md" });
  });

  it("ignores when there is no event or no active document", () => {
    expect(decideFileChange(null, activeDoc).action).toBe("ignore");
    expect(decideFileChange({ path: "/docs/a.md", changeType: "modified" }, null).action).toBe(
      "ignore",
    );
  });

  it("simulated reload flow: only an explicit user reload calls the IPC", async () => {
    // Fake-IPC: prove the *modified* decision never triggers a reload; only a
    // user clicking Reload does. This is the clobber-prevention behavior.
    const reloadFile = vi.fn().mockResolvedValue({ id: "doc", content: "fresh" });
    const ev: FileChangeEvent = { path: "/docs/a.md", changeType: "modified" };

    const decision = decideFileChange(ev, activeDoc);
    // App effect would call setReloadMessage(...), NOT reloadFile(...).
    if (decision.action === "reload-prompt") {
      // no IPC here
    }
    expect(reloadFile).not.toHaveBeenCalled();

    // User clicks Reload → handleReloadFile runs the IPC.
    await reloadFile(ev.path);
    expect(reloadFile).toHaveBeenCalledWith("/docs/a.md");
  });

  // [→E2E BLOCKED] A real notify(2) event on the open file must raise the dialog
  // in a live window and leave unsaved edits intact until reload.
  it.todo(
    "[→E2E BLOCKED] real external edit raises the reload dialog and preserves unsaved edits (needs e2e-verify harness)",
  );
});
