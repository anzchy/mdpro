// @vitest-environment node
/**
 * WI-5 (ADR-0031 step 4), case WI5-D.
 *
 * The Rust-only shortcut field `file_open_quickly` / `fileOpenQuickly` gets a
 * TypeScript counterpart so the two `KeyboardShortcuts` shapes agree.
 *
 * Scope fence: no row is added to `SHORTCUT_CATEGORIES` in
 * `KeyboardShortcutsSettings.tsx`. The field has no consumer, and exposing an
 * inert rebind control would manufacture a new D25 entry — ADR-0031 warns
 * against exactly that. This file therefore pins the value only.
 *
 * The structural cross-language assertion (Rust fixture vs TS constant) is
 * WI-8's, not this file's.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";

describe("DEFAULT_KEYBOARD_SHORTCUTS — fields shared with Rust", () => {
  it("carries fileOpenQuickly with the v2 value Rust's default_open_quickly() returns", () => {
    expect(DEFAULT_KEYBOARD_SHORTCUTS.fileOpenQuickly).toBe("<unassigned>");
  });

  it("keeps viewSource / viewWysiwyg matching the menu.rs accelerators", () => {
    // src-tauri/src/menu.rs:135 / :143 carry Some("Ctrl+2") / Some("Ctrl+4").
    expect(DEFAULT_KEYBOARD_SHORTCUTS.viewSource).toBe("Ctrl+2");
    expect(DEFAULT_KEYBOARD_SHORTCUTS.viewWysiwyg).toBe("Ctrl+4");
  });
});
