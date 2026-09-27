/**
 * Tests for editorPrefApply.ts
 *
 * Covers:
 *   - contentWidthToCss: all four content-width presets
 *   - fontFamilyToCss: all three font-family presets
 *   - applyEditorPref: CSS side effects on document.documentElement
 *   - applyEditorPref: CodeMirror compartment dispatch when editorView exists
 *   - applyEditorPref: null editorView — no crash for Compartment changes
 *   - applyCodeTheme: dispatches codeThemeCompartment reconfigure
 *   - applyAutoPair: dispatches closeBracketsCompartment reconfigure
 *
 * Edge cases:
 *   - contentWidth "full" → "none" (not a pixel value)
 *   - lineHeightX10 integer math (18 / 10 = "1.8", not "1.7999…")
 *   - null editorView must not throw
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Tauri + logging (required by stores/editorStore.ts import chain)
// ---------------------------------------------------------------------------
vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

// ---------------------------------------------------------------------------
// Mock editorStore — control what editorView is returned
// ---------------------------------------------------------------------------
const mockDispatch = vi.fn();
const mockEditorView = { dispatch: mockDispatch };
let mockViewValue: typeof mockEditorView | null = mockEditorView;

vi.mock("../src/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => ({ editorView: mockViewValue }),
  },
}));

// ---------------------------------------------------------------------------
// Mock CodeMirror compartments — avoid full CM initialisation in jsdom
// ---------------------------------------------------------------------------
vi.mock("../src/components/Editor/extensions/dynamicExtensions", () => ({
  wordWrapCompartment: {
    reconfigure: vi.fn((ext) => ({ type: "wordWrapReconfigure", ext })),
  },
  tabSizeCompartment: {
    reconfigure: vi.fn((ext) => ({ type: "tabSizeReconfigure", ext })),
  },
  closeBracketsCompartment: {
    reconfigure: vi.fn((ext) => ({ type: "closeBracketsReconfigure", ext })),
  },
  codeThemeCompartment: {
    reconfigure: vi.fn((ext) => ({ type: "codeThemeReconfigure", ext })),
  },
}));

vi.mock("@codemirror/view", () => ({
  EditorView: {
    lineWrapping: "lineWrapping",
  },
}));

vi.mock("@codemirror/autocomplete", () => ({
  closeBrackets: vi.fn(() => "closeBrackets"),
}));

vi.mock("@codemirror/language", () => ({
  indentUnit: { of: vi.fn((s: string) => `indentUnit:${s}`) },
  defaultHighlightStyle: "defaultHighlightStyle",
  syntaxHighlighting: vi.fn((s: unknown) => `syntaxHighlighting:${String(s)}`),
}));

vi.mock("@codemirror/theme-one-dark", () => ({ oneDark: "oneDark" }));

// ---------------------------------------------------------------------------
// Now import the module under test (after mocks are hoisted)
// ---------------------------------------------------------------------------
import {
  contentWidthToCss,
  fontFamilyToCss,
  applyEditorPref,
  applyCodeTheme,
  applyAutoPair,
} from "../src/components/common/settings/editorPrefApply";

// ---------------------------------------------------------------------------
// contentWidthToCss — pure helper
// ---------------------------------------------------------------------------
describe("contentWidthToCss", () => {
  it.each([
    ["narrow", "600px"],
    ["medium", "780px"],
    ["wide",   "900px"],
    ["full",   "none"],
  ] as const)("maps %s → %s", (width, expected) => {
    expect(contentWidthToCss(width)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// fontFamilyToCss — pure helper
// ---------------------------------------------------------------------------
describe("fontFamilyToCss", () => {
  it("returns a serif stack for 'serif'", () => {
    const result = fontFamilyToCss("serif");
    expect(result).toContain("serif");
    expect(result).not.toBe("");
  });

  it("returns a monospace stack for 'mono'", () => {
    const result = fontFamilyToCss("mono");
    expect(result).toContain("monospace");
  });

  it("returns a system stack for 'system'", () => {
    const result = fontFamilyToCss("system");
    expect(result).toContain("-apple-system");
  });

  it("returns a system stack for any unknown value (fallthrough default)", () => {
    const result = fontFamilyToCss("comic-sans");
    expect(result).toContain("-apple-system");
  });
});

// ---------------------------------------------------------------------------
// applyEditorPref — CSS variable side effects
// ---------------------------------------------------------------------------
describe("applyEditorPref — CSS variables", () => {
  beforeEach(() => {
    mockViewValue = mockEditorView;
    mockDispatch.mockClear();
    document.documentElement.style.removeProperty("--editor-font-size");
    document.documentElement.style.removeProperty("--editor-line-height");
    document.documentElement.style.removeProperty("--editor-content-width");
    document.documentElement.style.removeProperty("--editor-font-family");
  });

  it("fontSize sets --editor-font-size with px suffix", () => {
    applyEditorPref("fontSize", 18);
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("18px");
  });

  it("fontSize 12 (min boundary) sets correct value", () => {
    applyEditorPref("fontSize", 12);
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("12px");
  });

  it("lineHeightX10=18 sets --editor-line-height to '1.8' (exact string, no float drift)", () => {
    applyEditorPref("lineHeightX10", 18);
    expect(document.documentElement.style.getPropertyValue("--editor-line-height")).toBe("1.8");
  });

  it("lineHeightX10=12 sets --editor-line-height to '1.2'", () => {
    applyEditorPref("lineHeightX10", 12);
    expect(document.documentElement.style.getPropertyValue("--editor-line-height")).toBe("1.2");
  });

  it("contentWidth 'narrow' sets --editor-content-width to 600px", () => {
    applyEditorPref("contentWidth", "narrow");
    expect(document.documentElement.style.getPropertyValue("--editor-content-width")).toBe("600px");
  });

  it("contentWidth 'full' sets --editor-content-width to 'none'", () => {
    applyEditorPref("contentWidth", "full");
    expect(document.documentElement.style.getPropertyValue("--editor-content-width")).toBe("none");
  });

  it("fontFamily 'serif' sets --editor-font-family to a non-empty stack containing 'serif'", () => {
    applyEditorPref("fontFamily", "serif");
    const val = document.documentElement.style.getPropertyValue("--editor-font-family");
    expect(val).not.toBe("");
    expect(val).toContain("serif");
  });

  it("fontFamily 'mono' sets --editor-font-family to a monospace stack", () => {
    applyEditorPref("fontFamily", "mono");
    const val = document.documentElement.style.getPropertyValue("--editor-font-family");
    expect(val).toContain("monospace");
  });
});

// ---------------------------------------------------------------------------
// applyEditorPref — CodeMirror compartment dispatch
// ---------------------------------------------------------------------------
describe("applyEditorPref — compartment dispatch", () => {
  beforeEach(() => {
    mockViewValue = mockEditorView;
    mockDispatch.mockClear();
  });

  it("tabSize dispatches exactly once with effects", () => {
    applyEditorPref("tabSize", 2);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const call = mockDispatch.mock.calls[0][0] as { effects: unknown };
    expect(call).toHaveProperty("effects");
  });

  it("wordWrap=true dispatches exactly once", () => {
    applyEditorPref("wordWrap", true);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("wordWrap=false dispatches exactly once", () => {
    applyEditorPref("wordWrap", false);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("null editorView does not throw for tabSize (early return guard)", () => {
    mockViewValue = null;
    expect(() => applyEditorPref("tabSize", 4)).not.toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("null editorView does not throw for wordWrap (early return guard)", () => {
    mockViewValue = null;
    expect(() => applyEditorPref("wordWrap", true)).not.toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// applyCodeTheme
// ---------------------------------------------------------------------------
describe("applyCodeTheme", () => {
  beforeEach(() => {
    mockViewValue = mockEditorView;
    mockDispatch.mockClear();
  });

  it("dispatches once for 'oneDark' theme", () => {
    applyCodeTheme("oneDark");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches once for 'default' theme", () => {
    applyCodeTheme("default");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("null editorView does not throw", () => {
    mockViewValue = null;
    expect(() => applyCodeTheme("oneDark")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyAutoPair
// ---------------------------------------------------------------------------
describe("applyAutoPair", () => {
  beforeEach(() => {
    mockViewValue = mockEditorView;
    mockDispatch.mockClear();
  });

  it("dispatches once when enabled=true", () => {
    applyAutoPair(true);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches once when enabled=false", () => {
    applyAutoPair(false);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("null editorView does not throw", () => {
    mockViewValue = null;
    expect(() => applyAutoPair(true)).not.toThrow();
  });
});
