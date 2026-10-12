// @vitest-environment node
/**
 * Regression tests for issue #377 — Cmd+S causes a visible screen blink.
 *
 * Root cause: handleSave called setBusyLabel("Saving...") which mounts
 * <div class="busy-indicator"> with a border-bottom, shifting the workspace
 * down, then unmounts it ~10–50 ms later. The mount/unmount cycle of that
 * overlay is the layout shift the user sees as a blink.
 *
 * Fix: Remove setBusyLabel from the save path entirely. The busy overlay is
 * appropriate for long operations (open, export, reload); for saves it causes
 * visible layout shift with no user benefit — the "Saved" toast is sufficient.
 * performSave() lives in src/services/saveService.ts and is tested here
 * without mounting the App component.
 *
 * These tests verify the blink does not regress.
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { performSave } from "../src/services/saveService";

const appSrc = [
  fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf-8"),
  // D171: the Reload handler (and its busy label) moved into this hook.
  fs.readFileSync(path.resolve(__dirname, "../src/hooks/useExternalChangePrompt.ts"), "utf-8"),
].join("\n");

// ── A) Source regression tests ────────────────────────────────────────────────

describe("App.tsx — handleSave blink fix (#377)", () => {
  it("handleSave does not call setBusyLabel('Saving...') — primary blink cause removed", () => {
    // This pattern is the primary cause of the blink (layout shift).
    // Removing it from handleSave stops the mount/unmount cycle.
    expect(appSrc).not.toMatch(/setBusyLabel\("Saving\.\.\."\)/);
  });

  it("handleSave no longer marks a frontend save window (D86 WI-4)", () => {
    // Rust recognises our own saves; the frontend window that used to hide them
    // also swallowed real external changes right after ⌘S.
    expect(appSrc).not.toMatch(/markSaveInProgress/);
  });

  it("other handlers (open, export, reload) still use setBusyLabel for long operations", () => {
    // Busy indicator is still appropriate for operations that take > 100ms.
    expect(appSrc).toMatch(/setBusyLabel\("Opening file\.\.\."\)/);
    expect(appSrc).toMatch(/setBusyLabel\("Exporting HTML\.\.\."\)/);
    expect(appSrc).toMatch(/setBusyLabel\("Reloading\.\.\."\)/);
  });

  it("busy-indicator element is still rendered conditionally for other operations", () => {
    // The busy-indicator div must remain in the component tree for the
    // other long-running operations (open, export, reload).
    expect(appSrc).toMatch(/busy-indicator/);
    expect(appSrc).toMatch(/busyLabel\s*\?/);
  });
});

// ── B) performSave behavioral tests ──────────────────────────────────────────
//
// performSave lives in src/services/saveService.ts and is tested directly —
// no component rendering or mock gymnastics needed.

describe("performSave — behavioral contracts (#377)", () => {
  it("on success: save, then recent files, then the toast", async () => {
    const callOrder: string[] = [];
    const deps = {
      saveActiveDocument: vi.fn(async () => { callOrder.push("save"); return { success: true, path: "/doc.md" }; }),
      updateRecentFiles: vi.fn(() => { callOrder.push("recent"); }),
      showToast: vi.fn(() => { callOrder.push("toast"); }),
    };

    await performSave("action-id", deps);

    expect(callOrder).toEqual(["save", "recent", "toast"]);
    expect(deps.showToast).toHaveBeenCalledWith("Saved");
    expect(deps.updateRecentFiles).toHaveBeenCalledWith("/doc.md");
  });

  it("on save failure (success=false): no toast shown", async () => {
    const deps = {
      saveActiveDocument: vi.fn().mockResolvedValue({ success: false, path: null }),
      updateRecentFiles: vi.fn(),
      showToast: vi.fn(),
    };

    await performSave(undefined, deps);

    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.saveActiveDocument).toHaveBeenCalledTimes(1);
  });

  it("on null result (no active doc): no toast, no crash", async () => {
    const deps = {
      saveActiveDocument: vi.fn().mockResolvedValue(null),
      updateRecentFiles: vi.fn(),
      showToast: vi.fn(),
    };

    await expect(performSave(undefined, deps)).resolves.toBeUndefined();
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  it("on saveActiveDocument rejection: shows error toast, does not throw", async () => {
    const deps = {
      saveActiveDocument: vi.fn().mockRejectedValue(new Error("disk full")),
      updateRecentFiles: vi.fn(),
      showToast: vi.fn(),
    };

    await expect(performSave(undefined, deps)).resolves.toBeUndefined();
    expect(deps.showToast).toHaveBeenCalledWith("Save failed: disk full");
    expect(deps.updateRecentFiles).not.toHaveBeenCalled();
  });

  it("does not reference setBusyLabel — no busy state introduced", async () => {
    // Guard: if anyone re-introduces a setBusyLabel call in performSave,
    // this test catches it via source inspection of the extracted function.
    const serviceSrc = fs.readFileSync(path.resolve(__dirname, "../src/services/saveService.ts"), "utf-8");
    const performSaveMatch = serviceSrc.match(/export async function performSave[\s\S]{0,600}^}/m);
    expect(performSaveMatch).not.toBeNull();
    expect(performSaveMatch![0]).not.toContain("setBusyLabel");
  });
});
