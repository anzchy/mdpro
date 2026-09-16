/**
 * WI-1 — DEFAULT_PREFERENCES.logging must match the Rust default.
 *
 * `src/services/preferencesService.ts` declares DEFAULT_PREFERENCES with the
 * comment "must stay in sync with Rust UserPreferences::default()". The Rust
 * side (`src-tauri/src/models/log_entry.rs`, `impl Default for LogSettings`)
 * defaults to `{ enabled: true, level: Info }`. The TypeScript constant said
 * `enabled: false`, so the browser branch handed callers a logging default that
 * the backend would never produce.
 *
 * Cases A and B pin the corrected value on both browser-branch paths.
 * Cases C and D are containment, not regression: they pass before and after the
 * fix and exist to prove the one-line edit did not disturb its neighbours.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { preferencesService } from "../src/services/preferencesService";
import {
  DEFAULT_APPEARANCE_CONFIG,
  DEFAULT_AUTO_SAVE_CONFIG,
  DEFAULT_EDITOR_CONFIG,
  DEFAULT_EXPORT_CONFIG,
  DEFAULT_IMAGE_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_MARKDOWN_CONFIG,
  DEFAULT_MCP_CONFIG,
  DEFAULT_TAB_BAR_CONFIG,
} from "../src/types/preferences";

/** Remove __TAURI__ from both window and globalThis — the browser branch. */
const clearTauriGlobal = () => {
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  if (typeof window !== "undefined") {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  }
};

describe("preferencesService — DEFAULT_PREFERENCES.logging matches the Rust default", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    clearTauriGlobal();
  });

  afterEach(() => {
    clearTauriGlobal();
  });

  it("WI-1-A: getPreferences on the browser branch returns the Rust-matching logging default", async () => {
    // The real desktop shape no existing test covers: __TAURI_INTERNALS__ is
    // present but __TAURI__ is not, so isTauriEnv() still takes the browser
    // branch and the constant is what the caller actually receives.
    vi.stubGlobal("__TAURI_INTERNALS__", {});

    const prefs = await preferencesService.getPreferences();

    expect(prefs.logging).toEqual({ enabled: true, level: "info" });
    // Load-bearing: proves we read the constant on the browser branch rather
    // than round-tripping through IPC and asserting the mock's return value.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("WI-1-B: setPreferences' spread path does not leak a stale logging default", async () => {
    const merged = await preferencesService.setPreferences({ showSidebar: false });

    expect(merged.logging.enabled).toBe(true);
    expect(merged.logging.level).toBe("info");
    // Required: without this, a hardcoded `return DEFAULT_PREFERENCES` would
    // satisfy the logging assertions while dropping the caller's patch.
    expect(merged.showSidebar).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("WI-1-C: the rest of DEFAULT_PREFERENCES is unchanged (blast-radius containment)", async () => {
    const prefs = await preferencesService.getPreferences();

    // 1. Key-set completeness — the only assertion that can see a field being
    // added, removed, or renamed. No snapshot (rule 10): a snapshot would be
    // auto-updated past the exact regression it exists to catch.
    expect(Object.keys(prefs).sort()).toEqual([
      "appearance",
      "autoSave",
      "autoSaveInterval",
      "defaultViewMode",
      "editor",
      "enableScrollSync",
      "export",
      "image",
      "keyboardShortcuts",
      "lastViewMode",
      "logging",
      "markdown",
      "mcp",
      "recentFiles",
      "showSidebar",
      "tabBar",
      "themeMode",
      "windowState",
      "windowStates",
    ]);

    // 2. Literal values.
    expect(prefs.themeMode).toBe("system");
    expect(prefs.autoSaveInterval).toBe(30);
    expect(prefs.defaultViewMode).toBe("wysiwyg");
    expect(prefs.lastViewMode).toBe("wysiwyg");
    expect(prefs.showSidebar).toBe(true);
    expect(prefs.enableScrollSync).toBe(true);
    expect(prefs.recentFiles).toEqual([]);
    expect(prefs.windowState).toEqual({
      width: 1200,
      height: 800,
      x: 100,
      y: 100,
      isMaximized: false,
    });
    expect(prefs.windowStates).toEqual({});

    // 3. Referential identity. `toBe`, not `toEqual`: deep-asserting these
    // would copy nine other modules' defaults into this test, asserting their
    // specs rather than this one's and rotting on every unrelated change.
    // keyboardShortcuts and windowStates are the literal neighbours of the
    // edited line — they are why this case exists.
    expect(prefs.keyboardShortcuts).toBe(DEFAULT_KEYBOARD_SHORTCUTS);
    expect(prefs.mcp).toBe(DEFAULT_MCP_CONFIG);
    expect(prefs.editor).toBe(DEFAULT_EDITOR_CONFIG);
    expect(prefs.markdown).toBe(DEFAULT_MARKDOWN_CONFIG);
    expect(prefs.appearance).toBe(DEFAULT_APPEARANCE_CONFIG);
    expect(prefs.image).toBe(DEFAULT_IMAGE_CONFIG);
    expect(prefs.export).toBe(DEFAULT_EXPORT_CONFIG);
    expect(prefs.autoSave).toBe(DEFAULT_AUTO_SAVE_CONFIG);
    expect(prefs.tabBar).toBe(DEFAULT_TAB_BAR_CONFIG);
  });

  // WI-1-D. This assertion is BELOW LEVEL 6 — source-text inspection. It is
  // admissible only because its subject is a deliberate NON-change: isTauriEnv
  // is a scope fence held by an external review, and the claim is "these bytes
  // did not move". It is never admissible as a behavioral claim about
  // detection; the behavior is covered by preferences-tauri-detection.test.ts.
  //
  // Asserts against the SOURCE FILE's bytes, not this test file's — this file
  // itself contains the string __TAURI_INTERNALS__ (case A stubs it).
  it("WI-1-D: isTauriEnv is unchanged (scope fence)", () => {
    // Anchored on the running test file's own absolute path, so resolution
    // does not depend on where vitest was invoked from. `import.meta.url` is
    // not usable here: under Vite's transform it is not a file:// URL.
    const testPath = expect.getState().testPath;
    expect(testPath).toBeTruthy();
    const sourcePath = resolve(
      dirname(testPath as string),
      "../src/services/preferencesService.ts",
    );
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('"__TAURI__" in window');
    expect(source).toContain('"__TAURI__" in globalThis');
    expect(source).not.toContain("__TAURI_INTERNALS__");
    // Deviation from the literal spec, which said `not.toContain("isTauri")`:
    // the fenced function is named isTauriEnv, so the bare substring is
    // necessarily present and that assertion could never pass. The intent is
    // that no *bare* `isTauri` identifier exists — neither the old module-load
    // `const isTauri = isTauriEnv()` cache nor an imported `isTauri` helper.
    expect(source).not.toMatch(/isTauri(?!Env)/);
  });
});
