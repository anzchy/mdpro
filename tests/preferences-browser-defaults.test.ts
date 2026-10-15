// @vitest-environment node
/**
 * ADR-0031 step 5b (WI-3) — preferencesService browser branch: defaults and merge.
 *
 * Replaces the deleted fence `tests/preferences-logging-default.test.ts`. Its
 * behavioural assertions A–C are migrated here through the public
 * `getPreferences()` / `setPreferences()` output (DEC-3); its source-text check D
 * is retired with the `__TAURI__` detector it fenced.
 *
 * Matrix `.claude/tdd-guardian/tests-20260927-031000.md` B1–B5. Law: right-biased,
 * non-mutating merge — for every patch `p`, `setPreferences(p)` returns `R` with
 * `R[k]` deep-equal to `p[k]` when `k ∈ p` and to the default otherwise, the key
 * set of the defaults, and the defaults themselves never change.
 *
 * Every case runs with the `isTauri` spy false and asserts `invoke` was never
 * called, so an accidental IPC round-trip cannot pass for a browser value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { isTauri } from "@tauri-apps/api/core";
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
  type UserPreferences,
} from "../src/types/preferences";

/** One non-default value per key; the right type for each. */
const SINGLE_KEY_PATCHES: Array<Partial<UserPreferences>> = [
  { themeMode: "dark" },
  { autoSaveInterval: 777 },
  { defaultViewMode: "source" },
  { lastViewMode: "source" },
  { showSidebar: false },
  { sidebarWidth: 333 },
  { enableScrollSync: false },
  { recentFiles: ["/a.md"] },
  { windowState: { width: 1, height: 2, x: 3, y: 4, isMaximized: true } },
  { keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS, fileNew: "Cmd+Alt+N" } },
  { logging: { enabled: false, level: "warn" } },
  { windowStates: { "/a.md": { x: 1, y: 2, width: 3, height: 4 } } },
  { mcp: { serverEnabled: false, startOnLaunch: true, autoApproveEdits: true } },
  { editor: { ...DEFAULT_EDITOR_CONFIG, fontSize: 20 } },
  { markdown: { autoPair: false, autoReformatTablesOnSave: true } },
  { appearance: { codeTheme: "oneDark" } },
  { image: { ...DEFAULT_IMAGE_CONFIG, maxDimension: 800 } },
  { export: { defaultFolder: "/out", htmlIncludeStyles: false } },
  { autoSave: { ...DEFAULT_AUTO_SAVE_CONFIG, enabled: false } },
  { tabBar: { ...DEFAULT_TAB_BAR_CONFIG, position: "bottom" } },
];

const PATCHES: Array<{ name: string; patch: Partial<UserPreferences> }> = [
  ...SINGLE_KEY_PATCHES.map((patch) => ({ name: Object.keys(patch)[0], patch })),
  { name: "migrated B", patch: { showSidebar: false } },
  { name: "three keys", patch: { themeMode: "light", recentFiles: ["/b.md", "/c.md"], autoSaveInterval: 5 } },
  { name: "empty", patch: {} },
];

beforeEach(() => {
  invokeMock.mockReset();
  vi.mocked(isTauri).mockReturnValue(false);
});

describe("preferencesService — browser-branch defaults (migrated fence A–C)", () => {
  it("B1: getPreferences returns the Rust-matching logging default", async () => {
    const prefs = await preferencesService.getPreferences("app_hydrate");

    expect(prefs.logging).toEqual({ enabled: true, level: "info" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("B2: the default key set is exactly the 20 UserPreferences keys", async () => {
    const prefs = await preferencesService.getPreferences("app_hydrate");

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
      "sidebarWidth",
      "tabBar",
      "themeMode",
      "windowState",
      "windowStates",
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("B3: literal scalar defaults; nested groups equal the exported constants", async () => {
    const prefs = await preferencesService.getPreferences("app_hydrate");

    expect(prefs.themeMode).toBe("system");
    expect(prefs.autoSaveInterval).toBe(30);
    expect(prefs.defaultViewMode).toBe("wysiwyg");
    expect(prefs.lastViewMode).toBe("wysiwyg");
    expect(prefs.showSidebar).toBe(true);
    expect(prefs.sidebarWidth).toBe(220);
    expect(prefs.enableScrollSync).toBe(true);
    expect(prefs.recentFiles).toEqual([]);
    expect(prefs.windowState).toEqual({ width: 1200, height: 800, x: 100, y: 100, isMaximized: false });
    expect(prefs.windowStates).toEqual({});

    // `toEqual`, not the fence's `toBe`: identity would pin an implementation
    // detail (no defensive copy) rather than the value (matrix B3, flagged).
    expect(prefs.keyboardShortcuts).toEqual(DEFAULT_KEYBOARD_SHORTCUTS);
    expect(prefs.mcp).toEqual(DEFAULT_MCP_CONFIG);
    expect(prefs.editor).toEqual(DEFAULT_EDITOR_CONFIG);
    expect(prefs.markdown).toEqual(DEFAULT_MARKDOWN_CONFIG);
    expect(prefs.appearance).toEqual(DEFAULT_APPEARANCE_CONFIG);
    expect(prefs.image).toEqual(DEFAULT_IMAGE_CONFIG);
    expect(prefs.export).toEqual(DEFAULT_EXPORT_CONFIG);
    expect(prefs.autoSave).toEqual(DEFAULT_AUTO_SAVE_CONFIG);
    expect(prefs.tabBar).toEqual(DEFAULT_TAB_BAR_CONFIG);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("preferencesService — browser-branch setPreferences merge law", () => {
  it("B4: right-biased merge over every single-key patch, the migrated row, a 3-key patch and {}", async () => {
    expect(SINGLE_KEY_PATCHES).toHaveLength(20);
    expect(PATCHES).toHaveLength(23);
    const defaults = await preferencesService.getPreferences("app_hydrate");
    const defaultKeys = Object.keys(defaults).sort();
    expect(defaultKeys).toHaveLength(20);
    expect(new Set(SINGLE_KEY_PATCHES.map((p) => Object.keys(p)[0]))).toEqual(new Set(defaultKeys));

    for (const { name, patch } of PATCHES) {
      const merged = await preferencesService.setPreferences(patch);
      const tag = `row ${name}`;
      expect(Object.keys(merged).sort(), tag).toEqual(defaultKeys);
      for (const key of defaultKeys as Array<keyof UserPreferences>) {
        const expected = key in patch ? patch[key] : defaults[key];
        expect(merged[key], `${tag} key ${key}`).toEqual(expected);
      }
      if (name === "migrated B") {
        expect(merged.logging, tag).toEqual({ enabled: true, level: "info" });
        expect(merged.showSidebar, tag).toBe(false);
      }
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("B5: setPreferences and mutation of its results never change the defaults", async () => {
    const snapshot = structuredClone(await preferencesService.getPreferences("app_hydrate"));

    let last: UserPreferences | null = null;
    for (const { patch } of PATCHES) last = await preferencesService.setPreferences(patch);
    expect(last).not.toBeNull();

    // Step 3: mutate the returned value's nested groups, as a careless caller would.
    const result = last as UserPreferences;
    result.recentFiles.push("/mutated.md");
    result.mcp.serverEnabled = false;

    expect(await preferencesService.getPreferences("app_hydrate")).toEqual(snapshot);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
