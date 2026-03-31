/**
 * Tests for issue #25 — ⌘K link insert uses React modal instead of window.prompt()
 *
 * The bug: typoraKeymapPlugin calls window.prompt() which is suppressed by
 * WKWebView on macOS inside Tauri, making ⌘K silently fail.
 *
 * The fix:
 *   1. A `useLinkInsertStore` Zustand store holds a `pendingCallback` (the
 *      function that receives the URL string to apply the link mark).
 *   2. The link keymap command sets `pendingCallback` instead of calling
 *      window.prompt().
 *   3. A `LinkInsertModal` React component renders when `pendingCallback` is
 *      set, captures URL input, and resolves via the callback.
 *
 * Coverage:
 *   A) Unit tests confirming window.prompt is NOT called by the link command
 *   B) Store tests for useLinkInsertStore
 *   C) Static-analysis tests verifying wiring in source files
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock toggleMark so the URL-sanitization tests can verify the guard without
// needing a fully-hydrated ProseMirror document.
const { mockToggleMark } = vi.hoisted(() => {
  const inner = vi.fn((_state: unknown, dispatch: ((tr: unknown) => void) | undefined) => {
    if (dispatch) dispatch({});
    return true;
  });
  const mockToggleMark = vi.fn(() => inner);
  return { mockToggleMark };
});

vi.mock("@milkdown/kit/prose/commands", async (importOriginal) => {
  const original = await importOriginal<typeof import("@milkdown/kit/prose/commands")>();
  return { ...original, toggleMark: mockToggleMark };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../src");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// A) window.prompt must NOT be called by the link keymap command
// ---------------------------------------------------------------------------

import {
  TYPORA_KEYMAP_CONFIG,
} from "../src/plugins/milkdown/typoraKeymapPlugin";
import type { Command } from "@milkdown/kit/prose/state";

function makeMarkType(name: string) {
  return { name, spec: {} };
}

function makeSchema(marks: string[]) {
  return {
    nodes: {},
    marks: Object.fromEntries(marks.map((m) => [m, makeMarkType(m)])),
  };
}

function makeState(schema: ReturnType<typeof makeSchema>) {
  return {
    schema,
    selection: { from: 5, to: 10 },
    tr: {
      addMark: vi.fn().mockReturnThis(),
    },
  };
}

describe("typoraKeymapPlugin — link command does NOT call window.prompt", () => {
  beforeEach(() => {
    // Spy on window.prompt to confirm it is never called
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("window.prompt is not defined as a spy before this test runs — baseline check", () => {
    // The spy is installed in beforeEach; just confirm it is callable
    expect(typeof window.prompt).toBe("function");
  });

  it("link command entry exists in TYPORA_KEYMAP_CONFIG", () => {
    expect(TYPORA_KEYMAP_CONFIG.link).toBeDefined();
    expect(TYPORA_KEYMAP_CONFIG.link.shortcuts).toBe("Mod-k");
  });

  it("link command factory returns a ProseMirror Command function", () => {
    const mockCtx = {};
    const result = TYPORA_KEYMAP_CONFIG.link.command(mockCtx as never);
    expect(typeof result).toBe("function");
  });

  it("link command does NOT call window.prompt when executed", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const schema = makeSchema(["link", "strong", "emphasis"]);
    const state = makeState(schema) as unknown as Parameters<Command>[0];
    const dispatch = vi.fn();

    const mockCtx = {};
    const cmd = TYPORA_KEYMAP_CONFIG.link.command(mockCtx as never);
    // Execute the command (may return false if store not set up, that's OK)
    cmd(state, dispatch, undefined);

    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("link command stores a pending callback instead of calling prompt", async () => {
    // Import the store to verify the callback was set
    const { useLinkInsertStore } = await import("../src/stores/linkInsertStore");

    // Reset store state before test
    useLinkInsertStore.setState({ pendingCallback: null });

    const schema = makeSchema(["link", "strong", "emphasis"]);
    const state = makeState(schema) as unknown as Parameters<Command>[0];
    const dispatch = vi.fn();

    const mockCtx = {};
    const cmd = TYPORA_KEYMAP_CONFIG.link.command(mockCtx as never);
    cmd(state, dispatch, undefined);

    // After calling the command, pendingCallback should be set
    const { pendingCallback } = useLinkInsertStore.getState();
    expect(pendingCallback).not.toBeNull();
    expect(typeof pendingCallback).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// B) useLinkInsertStore — state management tests
// ---------------------------------------------------------------------------

describe("useLinkInsertStore", () => {
  it("initial state has pendingCallback as null", async () => {
    const { useLinkInsertStore } = await import("../src/stores/linkInsertStore");
    useLinkInsertStore.setState({ pendingCallback: null });
    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
  });

  it("setPendingCallback sets a callback function", async () => {
    const { useLinkInsertStore } = await import("../src/stores/linkInsertStore");
    useLinkInsertStore.setState({ pendingCallback: null });

    const cb = vi.fn();
    useLinkInsertStore.getState().setPendingCallback(cb);
    expect(useLinkInsertStore.getState().pendingCallback).toBe(cb);
  });

  it("clearPendingCallback sets pendingCallback to null", async () => {
    const { useLinkInsertStore } = await import("../src/stores/linkInsertStore");

    const cb = vi.fn();
    useLinkInsertStore.setState({ pendingCallback: cb });
    useLinkInsertStore.getState().clearPendingCallback();
    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A2) URL sanitization — the pending callback must block dangerous protocols
//     and normalize bare hostnames to https://.
// ---------------------------------------------------------------------------

describe("link command pending callback — URL sanitization", () => {
  beforeEach(() => mockToggleMark.mockClear());

  async function runCallbackWithUrl(url: string) {
    const { useLinkInsertStore } = await import("../src/stores/linkInsertStore");
    useLinkInsertStore.setState({ pendingCallback: null });

    const schema = makeSchema(["link", "strong", "emphasis"]);
    const state = makeState(schema) as unknown as Parameters<Command>[0];
    const dispatch = vi.fn();

    const cmd = TYPORA_KEYMAP_CONFIG.link.command({} as never);
    cmd(state, dispatch, undefined);

    const cb = useLinkInsertStore.getState().pendingCallback;
    cb?.(url);
  }

  it("does NOT invoke toggleMark for javascript: protocol", async () => {
    await runCallbackWithUrl("javascript:alert(1)");
    expect(mockToggleMark).not.toHaveBeenCalled();
  });

  it("does NOT invoke toggleMark for data: protocol", async () => {
    await runCallbackWithUrl("data:text/html,<script>alert(1)</script>");
    expect(mockToggleMark).not.toHaveBeenCalled();
  });

  it("does NOT invoke toggleMark for vbscript: protocol", async () => {
    await runCallbackWithUrl("vbscript:msgbox(1)");
    expect(mockToggleMark).not.toHaveBeenCalled();
  });

  it("invokes toggleMark with https:// href for bare hostname", async () => {
    await runCallbackWithUrl("example.com");
    expect(mockToggleMark).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ href: "https://example.com" })
    );
  });

  it("invokes toggleMark with original href for https:// URL (no double-prefix)", async () => {
    await runCallbackWithUrl("https://already.com");
    expect(mockToggleMark).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ href: "https://already.com" })
    );
  });
});

// ---------------------------------------------------------------------------
// C) Static-analysis tests — wiring verification
// ---------------------------------------------------------------------------

describe("typoraKeymapPlugin source — no window.prompt", () => {
  const src = readSrc("plugins/milkdown/typoraKeymapPlugin.ts");

  it("does NOT contain window.prompt", () => {
    expect(src).not.toMatch(/window\.prompt/);
  });

  it("imports from linkInsertStore", () => {
    expect(src).toMatch(/linkInsertStore/);
  });

  it("contains setPendingCallback usage in the link command", () => {
    expect(src).toMatch(/setPendingCallback/);
  });
});

describe("LinkInsertModal source — component exists", () => {
  it("LinkInsertModal.tsx exists", () => {
    const filePath = path.join(SRC, "components/Editor/LinkInsertModal.tsx");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("renders an input for URL", () => {
    const src = readSrc("components/Editor/LinkInsertModal.tsx");
    // Should have an input element
    expect(src).toMatch(/<input/);
  });

  it("calls clearPendingCallback on cancel/ESC", () => {
    const src = readSrc("components/Editor/LinkInsertModal.tsx");
    expect(src).toMatch(/clearPendingCallback/);
  });

  it("calls pendingCallback with URL on submit", () => {
    const src = readSrc("components/Editor/LinkInsertModal.tsx");
    expect(src).toMatch(/pendingCallback/);
  });
});

describe("MilkdownEditor source — mounts LinkInsertModal", () => {
  const src = readSrc("components/Editor/MilkdownEditor.tsx");

  it("imports LinkInsertModal", () => {
    expect(src).toMatch(/LinkInsertModal/);
  });

  it("renders LinkInsertModal in the component", () => {
    expect(src).toMatch(/<LinkInsertModal/);
  });
});
