/**
 * D24 WI-2 — the explicit view-mode entry points record a user choice
 * (ADR-0031 step 6). Matrix: `.claude/tdd-guardian/tests-20261007-171405.md`,
 * cases UEP-01 and UEP-02.
 *
 * What this file pins, and what it does not:
 *   - UEP-01: `useMenuEvents`' positional `(mode, actionId)` call is compatible
 *     with `userViewModeCommands`, so a `set-view-mode` / `cycle-view-mode`
 *     menu event bumps `userViewModeChoice.seq` by exactly 1, a no-change set
 *     still counts (decision D-3), and an invalid value never bumps.
 *   - UEP-02: the cycle shortcut bumps once when fired outside CodeMirror and
 *     never when fired inside a `.cm-editor` (the `!inCodeMirror` guard; the
 *     Editor.tsx `Mod-/` keymap owns that case).
 *   - Neither case renders App, so neither verifies that App actually passes
 *     the adapter. That wiring is the source-text supplement UEP-03 in
 *     `tests/view-mode-intent-call-site.test.ts` (matrix F-4).
 *
 * Runs under jsdom: the editor store's import graph reaches DOMPurify at
 * module load (see `tests/view-mode-intent.test.ts`), and UEP-02 needs a DOM
 * to dispatch keydown events. Mock boundary: the three Tauri modules only —
 * `@tauri-apps/api/event` is an in-memory bus, `@tauri-apps/api/window`
 * reports the window focused, `@tauri-apps/api/core` swallows `log_event`.
 * The editor store, loggingService and both hooks are real.
 *
 * CORRECTION to the matrix (UEP-02 input, recorded, not quietly applied): the
 * matrix runs the shortcut off-mac with `ctrlKey`. That can never match:
 * off-mac, `matchesShortcut` maps "Cmd" to `ctrlKey` and then rejects the same
 * `ctrlKey` through `wantCtrl !== event.ctrlKey`, so no "Cmd+…" shortcut fires
 * on Windows/Linux (a pre-existing defect, out of D24 scope). mdpro targets
 * macOS only, so this file sets `navigator.platform` to "MacIntel" before
 * `useKeyboardShortcuts` loads (its `isMac` is a module-level constant):
 * row (a) uses `metaKey`, and the control row (c) uses `ctrlKey`, the wrong
 * primary modifier on mac.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { bus } = vi.hoisted(() => {
  // Before any import: `useKeyboardShortcuts` reads isMac once at module load.
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
  type Handler = (event: { payload: unknown }) => void;
  const handlers = new Map<string, Set<Handler>>();
  const bus = {
    handlers,
    listen(evt: string, handler: Handler): Promise<() => void> {
      const set = handlers.get(evt) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(evt, set);
      return Promise.resolve(() => {
        set.delete(handler);
      });
    },
    emit(evt: string, payload: unknown): void {
      [...(handlers.get(evt) ?? [])].forEach((handler) => handler({ payload }));
    },
  };
  return { bus };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (evt: string, handler: (event: { payload: unknown }) => void) => bus.listen(evt, handler),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    isFocused: (): Promise<boolean> => Promise.resolve(true),
  }),
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: vi.fn(async () => null) }),
);

import { useMenuEvents } from "../src/hooks/useMenuEvents";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { useEditorStore, userViewModeCommands } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";

const MENU_EVENT = "menu:action";
const SETTLE_TURNS = 10;

function choice() {
  return useEditorStore.getState().userViewModeChoice;
}

/** Let the async focus check (and the listen() resolution) settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < SETTLE_TURNS; i += 1) await Promise.resolve();
  });
}

async function dispatchMenu(payload: { action: string; value?: string }): Promise<void> {
  bus.emit(MENU_EVENT, payload);
  await settle();
}

beforeEach(() => {
  bus.handlers.clear();
  useEditorStore.setState({
    viewMode: "wysiwyg",
    userViewModeChoice: { seq: 0, mode: "wysiwyg" },
    editorView: null,
  });
  useMilkdownEditorStore.setState({ flushers: {} });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("UEP-01 menu events record user choices through the adapter", () => {
  it("set, cycle, a no-change set (D-3) and an invalid value give the exact choice sequence", async () => {
    const { unmount } = renderHook(() =>
      useMenuEvents({
        onNew: vi.fn(),
        onOpen: vi.fn(),
        onSave: vi.fn(),
        onViewModeChange: userViewModeCommands.set,
        onCycleViewMode: userViewModeCommands.cycle,
      }),
    );
    await settle();
    expect(bus.handlers.get(MENU_EVENT)?.size).toBe(1);
    expect(choice()).toEqual({ seq: 0, mode: "wysiwyg" });

    await dispatchMenu({ action: "set-view-mode", value: "source" });
    expect(choice()).toEqual({ seq: 1, mode: "source" });
    expect(useEditorStore.getState().viewMode).toBe("source");

    await dispatchMenu({ action: "cycle-view-mode" });
    expect(choice()).toEqual({ seq: 2, mode: "wysiwyg" });
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");

    // D-3: an explicit pick of the current mode still counts as a choice.
    await dispatchMenu({ action: "set-view-mode", value: "wysiwyg" });
    expect(choice()).toEqual({ seq: 3, mode: "wysiwyg" });

    // Guard row: a value outside ViewMode never reaches the adapter.
    await dispatchMenu({ action: "set-view-mode", value: "split" });
    expect(choice()).toEqual({ seq: 3, mode: "wysiwyg" });
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");

    unmount();
  });
});

describe("UEP-02 the cycle shortcut bumps once outside CodeMirror and never inside", () => {
  function keydown(init: KeyboardEventInit): KeyboardEvent {
    return new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true, ...init });
  }

  it("(a) outside bumps once, (b) inside .cm-editor does not, (c) the wrong modifier does not", () => {
    // Precondition the expected rows depend on: the platform reads as mac, so
    // the default "Cmd+/" maps to metaKey.
    expect(/Mac/i.test(navigator.platform)).toBe(true);

    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({ onCycleViewMode: userViewModeCommands.cycle }),
    );

    // (a) document body — the window-level handler cycles once.
    document.body.dispatchEvent(keydown({ metaKey: true }));
    expect(choice()).toEqual({ seq: 1, mode: "source" });
    expect(useEditorStore.getState().viewMode).toBe("source");

    // (b) inside CodeMirror — the guard keeps the app shortcut out.
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const inner = document.createElement("div");
    inner.tabIndex = 0;
    inner.id = "cm-inner";
    editor.appendChild(inner);
    document.body.appendChild(editor);
    inner.dispatchEvent(keydown({ metaKey: true }));
    expect(choice()).toEqual({ seq: 1, mode: "source" });
    expect(useEditorStore.getState().viewMode).toBe("source");

    // (c) control: ctrlKey is the wrong primary modifier on mac.
    document.body.dispatchEvent(keydown({ ctrlKey: true, metaKey: false }));
    expect(choice()).toEqual({ seq: 1, mode: "source" });

    unmount();
  });
});
