/**
 * `useKeyboardShortcuts` — behaviour of the window-level keydown handler.
 *
 * The sibling `tests/use-keyboard-shortcuts.test.ts` inspects the hook's
 * source text; this file runs the hook. Added during D24 WI-2 (orchestrator
 * option (a)): UEP-02 became the first test to load the module, which put its
 * real branches into the `all: true` coverage denominator.
 *
 * What is pinned, all through real `KeyboardEvent`s on `window`:
 *   - each mapped app shortcut calls exactly its own handler, once, with the
 *     actionId of the `ui.shortcut.trigger` line it logged, and prevents the
 *     default;
 *   - the six table shortcuts call `onTableAction(id, actionId)`;
 *   - modifiers match exactly (wrong primary modifier, extra Shift, extra
 *     Ctrl, unmapped key: nothing fires and the default is not prevented);
 *   - the `inCodeMirror` guard: highlight, cycle and insert-table stay out of
 *     a `.cm-editor` target while save still fires there; the heading and
 *     paragraph shortcuts edit the real CodeMirror document only when the
 *     target is inside the editor AND the store holds an `editorView`;
 *   - a custom `shortcuts` map replaces the defaults;
 *   - unmount removes the listener, and a re-render with a new handler leaves
 *     exactly one live listener.
 *
 * Platform: `navigator.platform` is set to "MacIntel" before the hook module
 * loads (its `isMac` is a module-level constant), the app's only target. The
 * off-mac Cmd→ctrlKey path is deliberately not asserted either way: it has a
 * known pre-existing defect, filed as D50 (not fixed).
 *
 * Not covered: Cmd+K (`formatHyperlink`) inside the editor. Its command opens
 * the in-app `LinkInsertModal` through `linkInsertStore` (D55); that path is
 * covered by `tests/d55-source-link-insert.test.tsx`.
 *
 * Mock boundary: `@tauri-apps/api/core` only; its `invoke("log_event")` calls
 * are read back to correlate actionIds. loggingService, the editor store and
 * CodeMirror are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const ipc = vi.hoisted(() => {
  // Before any import: `useKeyboardShortcuts` reads isMac once at module load.
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
  return { invoke: vi.fn(async () => null) };
});

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: ipc.invoke, isTauri: true }),
);

import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";

type HandlerName =
  | "onNew"
  | "onHighlight"
  | "onExportHtml"
  | "onToggleSidebar"
  | "onOpen"
  | "onSave"
  | "onClose"
  | "onCycleViewMode"
  | "onOpenPreferences"
  | "onInsertTable";

const HANDLER_NAMES: HandlerName[] = [
  "onNew",
  "onHighlight",
  "onExportHtml",
  "onToggleSidebar",
  "onOpen",
  "onSave",
  "onClose",
  "onCycleViewMode",
  "onOpenPreferences",
  "onInsertTable",
];

function makeHandlers() {
  const handlers = Object.fromEntries(HANDLER_NAMES.map((name) => [name, vi.fn()])) as Record<
    HandlerName,
    ReturnType<typeof vi.fn>
  >;
  return { ...handlers, onTableAction: vi.fn() };
}

type Handlers = ReturnType<typeof makeHandlers>;

function totalCalls(handlers: Handlers): number {
  return [...HANDLER_NAMES.map((n) => handlers[n]), handlers.onTableAction].reduce(
    (sum, fn) => sum + fn.mock.calls.length,
    0,
  );
}

interface ShortcutLog {
  actionId: string;
  context: { shortcut: string; action: string };
}

function shortcutLogs(): ShortcutLog[] {
  return ipc.invoke.mock.calls
    .filter((call) => (call as unknown[])[0] === "log_event")
    .map((call) => ((call as unknown[])[1] as { payload: ShortcutLog & { event: string } }).payload)
    .filter((payload) => (payload as { event: string }).event === "ui.shortcut.trigger");
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function cmEditorTarget(): HTMLElement {
  const editor = document.createElement("div");
  editor.className = "cm-editor";
  const inner = document.createElement("div");
  inner.tabIndex = 0;
  editor.appendChild(inner);
  document.body.appendChild(editor);
  return inner;
}

beforeEach(() => {
  useEditorStore.setState({ editorView: null });
  useLoggingStore.setState({ enabled: true, level: "debug" });
  ipc.invoke.mockClear();
});

afterEach(() => {
  useEditorStore.getState().editorView?.destroy();
  useEditorStore.setState({ editorView: null });
  document.body.innerHTML = "";
});

describe("app shortcuts call exactly their own handler", () => {
  it.each([
    { handler: "onNew", init: { key: "n", metaKey: true }, shortcut: "Cmd+N", action: "file.new" },
    {
      handler: "onHighlight",
      init: { key: "M", metaKey: true, shiftKey: true },
      shortcut: "Cmd+Shift+M",
      action: "format.highlight",
    },
    {
      handler: "onExportHtml",
      init: { key: "E", metaKey: true, shiftKey: true },
      shortcut: "Cmd+Shift+E",
      action: "file.export_html",
    },
    {
      handler: "onToggleSidebar",
      init: { key: "L", metaKey: true, shiftKey: true },
      shortcut: "Cmd+Shift+L",
      action: "view.toggle_sidebar",
    },
    { handler: "onOpen", init: { key: "o", metaKey: true }, shortcut: "Cmd+O", action: "file.open" },
    { handler: "onSave", init: { key: "s", metaKey: true }, shortcut: "Cmd+S", action: "file.save" },
    { handler: "onClose", init: { key: "w", metaKey: true }, shortcut: "Cmd+W", action: "file.close" },
    { handler: "onCycleViewMode", init: { key: "/", metaKey: true }, shortcut: "Cmd+/", action: "view.cycle" },
    {
      handler: "onOpenPreferences",
      init: { key: ",", metaKey: true },
      shortcut: "Cmd+,",
      action: "file.preferences",
    },
    {
      handler: "onInsertTable",
      init: { key: "T", metaKey: true, shiftKey: true },
      shortcut: "Cmd+Shift+T",
      action: "paragraph.table",
    },
  ] as const)("$shortcut → $handler once, with its logged actionId", ({ handler, init, shortcut, action }) => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));

    const event = press(window, init);

    expect(event.defaultPrevented).toBe(true);
    const logs = shortcutLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toEqual({ shortcut, action });
    expect(handlers[handler].mock.calls).toEqual([[logs[0].actionId]]);
    expect(totalCalls(handlers)).toBe(1);
    unmount();
  });

  it.each([
    { init: { key: "ArrowUp" }, id: "insert_row_before" },
    { init: { key: "ArrowDown" }, id: "insert_row_after" },
    { init: { key: "ArrowLeft" }, id: "insert_column_before" },
    { init: { key: "ArrowRight" }, id: "insert_column_after" },
    { init: { key: "Backspace" }, id: "delete_row" },
    { init: { key: "Backspace", shiftKey: true }, id: "delete_column" },
  ] as const)("table shortcut $init.key (shift: $init.shiftKey) → onTableAction('$id')", ({ init, id }) => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));

    const event = press(window, { metaKey: true, altKey: true, ...init });

    expect(event.defaultPrevented).toBe(true);
    const logs = shortcutLogs();
    expect(logs.map((l) => l.context.action)).toEqual([`editor.table.${id}`]);
    expect(handlers.onTableAction.mock.calls).toEqual([[id, logs[0].actionId]]);
    expect(totalCalls(handlers)).toBe(1);
    unmount();
  });
});

describe("modifiers match exactly", () => {
  it.each([
    { name: "ctrlKey instead of Cmd (mac)", init: { key: "s", ctrlKey: true } },
    { name: "no modifier", init: { key: "s" } },
    { name: "extra Shift", init: { key: "S", metaKey: true, shiftKey: true } },
    { name: "extra Ctrl", init: { key: "s", metaKey: true, ctrlKey: true } },
    { name: "extra Option", init: { key: "s", metaKey: true, altKey: true } },
    { name: "unmapped key", init: { key: "j", metaKey: true } },
    { name: "Option+arrow without Cmd", init: { key: "ArrowUp", altKey: true } },
  ])("$name fires nothing and leaves the default alone", ({ init }) => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));

    const event = press(window, init);

    expect(totalCalls(handlers)).toBe(0);
    expect(event.defaultPrevented).toBe(false);
    expect(shortcutLogs()).toEqual([]);
    unmount();
  });

  it("a mapped shortcut with no handler supplied fires nothing", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts({}));
    const event = press(window, { key: "s", metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(shortcutLogs()).toEqual([]);
    unmount();
  });
});

describe("the inCodeMirror guard", () => {
  it.each([
    { handler: "onHighlight", init: { key: "H", metaKey: true, shiftKey: true } },
    { handler: "onCycleViewMode", init: { key: "/", metaKey: true } },
    { handler: "onInsertTable", init: { key: "t", metaKey: true, altKey: true } },
  ] as const)("$handler does not fire from inside .cm-editor", ({ handler, init }) => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));

    const event = press(cmEditorTarget(), init);

    expect(handlers[handler]).not.toHaveBeenCalled();
    expect(totalCalls(handlers)).toBe(0);
    expect(event.defaultPrevented).toBe(false);
    unmount();
  });

  it("unguarded shortcuts (save) still fire from inside .cm-editor", () => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));

    press(cmEditorTarget(), { key: "s", metaKey: true });

    const logs = shortcutLogs();
    expect(handlers.onSave.mock.calls).toEqual([[logs[0].actionId]]);
    expect(totalCalls(handlers)).toBe(1);
    unmount();
  });
});

describe("editor-only shortcuts need a CodeMirror target AND a store editorView", () => {
  function mountView(doc: string): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: 0 } }), parent });
    act(() => {
      useEditorStore.setState({ editorView: view });
    });
    return view;
  }

  it.each([
    { key: "1", expected: "# Title" },
    { key: "2", expected: "## Title" },
    { key: "3", expected: "### Title" },
    { key: "4", expected: "#### Title" },
    { key: "5", expected: "##### Title" },
    { key: "6", expected: "###### Title" },
  ])("Cmd+$key inside the editor rewrites the line to `$expected`", ({ key, expected }) => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    const view = mountView("Title");

    const event = press(view.contentDOM, { key, metaKey: true });

    expect(view.state.doc.toString()).toBe(expected);
    expect(event.defaultPrevented).toBe(true);
    expect(shortcutLogs().map((l) => l.context)).toEqual([
      { shortcut: `Cmd+${key}`, action: `paragraph.heading${key}` },
    ]);
    expect(totalCalls(handlers)).toBe(0);
    unmount();
  });

  it("Cmd+Shift+0 inside the editor strips the heading", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(makeHandlers()));
    const view = mountView("### Title");

    press(view.contentDOM, { key: "0", code: "Digit0", metaKey: true, shiftKey: true });

    expect(view.state.doc.toString()).toBe("Title");
    expect(shortcutLogs().map((l) => l.context.action)).toEqual(["paragraph.paragraph"]);
    unmount();
  });

  it("an app shortcut inside the editor with a view still reaches its handler (no editor match)", () => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    const view = mountView("Title");

    press(view.contentDOM, { key: "s", metaKey: true });

    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe("Title");
    unmount();
  });

  it("Cmd+1 outside the editor leaves the document alone, even with a view in the store", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(makeHandlers()));
    const view = mountView("Title");

    const event = press(window, { key: "1", metaKey: true });

    expect(view.state.doc.toString()).toBe("Title");
    expect(event.defaultPrevented).toBe(false);
    unmount();
  });

  it("Cmd+1 inside a .cm-editor with no view in the store does nothing", () => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));

    const event = press(cmEditorTarget(), { key: "1", metaKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(totalCalls(handlers)).toBe(0);
    unmount();
  });
});

describe("custom shortcut map", () => {
  it("replaces the default binding, including Space normalisation", () => {
    const handlers = makeHandlers();
    const shortcuts = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileSave: "Cmd+Shift+Space" };
    const { unmount } = renderHook(() => useKeyboardShortcuts({ ...handlers, shortcuts }));

    press(window, { key: "s", metaKey: true });
    expect(handlers.onSave).not.toHaveBeenCalled();

    press(window, { key: " ", metaKey: true, shiftKey: true });
    const logs = shortcutLogs();
    expect(logs.map((l) => l.context)).toEqual([{ shortcut: "Cmd+Shift+Space", action: "file.save" }]);
    expect(handlers.onSave.mock.calls).toEqual([[logs[0].actionId]]);
    unmount();
  });
});

describe("listener lifecycle", () => {
  it("unmount removes the listener: a key after unmount fires nothing", () => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    press(window, { key: "s", metaKey: true });
    expect(handlers.onSave).toHaveBeenCalledTimes(1);

    unmount();
    const event = press(window, { key: "s", metaKey: true });

    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(shortcutLogs()).toHaveLength(1);
  });

  it("a re-render with a new handler leaves exactly one live listener, on the new handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ onSave }) => useKeyboardShortcuts({ onSave }), {
      initialProps: { onSave: first },
    });
    rerender({ onSave: second });

    press(window, { key: "s", metaKey: true });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(shortcutLogs()).toHaveLength(1);
    unmount();
  });
});
