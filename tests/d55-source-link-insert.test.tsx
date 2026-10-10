/**
 * D55: ⌘K in Source mode does nothing in the packaged app.
 *
 * `insertLinkCommand` (src/plugins/codemirror/linkPlugin.ts) asked for the URL
 * with `window.prompt`, which WKWebView never shows: it returns null and the
 * command exits. The fix routes Source mode through the same in-app
 * `LinkInsertModal` that WYSIWYG uses (`useLinkInsertStore`), tagged with the
 * mode so the modal's log lines say which editor asked.
 *
 * Mocked only at the Tauri boundary. A real CodeMirror `EditorView` and the
 * real store and modal run; the assertions are on the document text, the store
 * and focus, not on CodeMirror's DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import * as fs from "fs";
import * as path from "path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertLinkCommand } from "../src/plugins/codemirror/linkPlugin";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { LinkInsertModal } from "../src/components/Editor/LinkInsertModal";
import { loggingService } from "../src/services/loggingService";

let view: EditorView | null = null;
let promptSpy: ReturnType<typeof vi.fn>;

// jsdom has no Range layout; CodeMirror's rAF measure calls it on a live view.
const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
let rangeShimmed: string[] = [];

function makeView(doc: string, from: number, to = from, readOnly = false): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: readOnly ? [EditorState.readOnly.of(true)] : [],
  });
  view = new EditorView({ state, parent: document.body });
  return view;
}

function linkLogs(event: string) {
  return vi
    .mocked(loggingService.logEventSync)
    .mock.calls.map(([entry]) => entry)
    .filter((entry) => entry.event === event);
}

beforeEach(() => {
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof rangeProto[name] !== "function");
  for (const name of rangeShimmed) {
    rangeProto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
  useLinkInsertStore.setState({ pendingCallback: null });
  promptSpy = vi.fn(() => null);
  vi.stubGlobal("prompt", promptSpy);
  vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

afterEach(() => {
  view?.destroy();
  view = null;
  for (const name of rangeShimmed) delete rangeProto[name];
  rangeShimmed = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("D55 — Source ⌘K opens the in-app link input", () => {
  it("D55-1 opens the modal without window.prompt, even when prompt would return null", () => {
    const v = makeView("say hello world", 4, 9);

    expect(insertLinkCommand(v)).toBe(true);

    expect(promptSpy).not.toHaveBeenCalled();
    expect(useLinkInsertStore.getState().pendingCallback).toBeTypeOf("function");
    expect(useLinkInsertStore.getState().mode).toBe("source");
    render(<LinkInsertModal />);
    expect(screen.getByRole("dialog", { name: "Insert link" })).toBeInTheDocument();
    expect(v.state.doc.toString()).toBe("say hello world");
  });

  it("D55-2 Enter inserts [selection](url) once, closes the modal and returns focus to the editor", async () => {
    const user = userEvent.setup();
    const v = makeView("say hello world", 4, 9);
    insertLinkCommand(v);
    render(<LinkInsertModal />);

    await user.type(screen.getByLabelText("URL"), "example.com{Enter}");

    expect(v.state.doc.toString()).toBe("say [hello](https://example.com) world");
    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Insert link" })).toBeNull();
    expect(v.contentDOM.contains(document.activeElement)).toBe(true);
    // The URL is selected afterwards, as before the fix.
    const sel = v.state.selection.main;
    expect(v.state.sliceDoc(sel.from, sel.to)).toBe("https://example.com");
  });

  it("D55-3 Escape cancels: the document is unchanged and focus returns to the editor", async () => {
    const user = userEvent.setup();
    const v = makeView("say hello world", 4, 9);
    insertLinkCommand(v);
    render(<LinkInsertModal />);

    await user.type(screen.getByLabelText("URL"), "example.com");
    await user.keyboard("{Escape}");

    expect(v.state.doc.toString()).toBe("say hello world");
    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Insert link" })).toBeNull();
    expect(v.contentDOM.contains(document.activeElement)).toBe(true);
  });

  it("D55-4 an empty selection inserts [link](url) at the caret", () => {
    const v = makeView("ab", 1);
    insertLinkCommand(v);
    act(() => {
      const cb = useLinkInsertStore.getState().pendingCallback!;
      useLinkInsertStore.getState().clearPendingCallback();
      cb("/docs");
    });
    expect(v.state.doc.toString()).toBe("a[link](/docs)b");
  });

  it("D55-5 a dangerous URL inserts nothing", () => {
    const v = makeView("say hello world", 4, 9);
    insertLinkCommand(v);
    act(() => {
      const cb = useLinkInsertStore.getState().pendingCallback!;
      useLinkInsertStore.getState().clearPendingCallback();
      cb("  JavaScript:alert(1)");
    });
    expect(v.state.doc.toString()).toBe("say hello world");
  });

  it("D55-6 a second ⌘K while the input is open keeps the first request (one insert)", async () => {
    const user = userEvent.setup();
    const v = makeView("say hello world", 4, 9);
    insertLinkCommand(v);
    const first = useLinkInsertStore.getState().pendingCallback;

    expect(insertLinkCommand(v)).toBe(true);
    expect(useLinkInsertStore.getState().pendingCallback).toBe(first);

    render(<LinkInsertModal />);
    await user.type(screen.getByLabelText("URL"), "x.io{Enter}");
    expect(v.state.doc.toString()).toBe("say [hello](https://x.io) world");
  });

  it("D55-7 a read-only editor opens nothing", () => {
    const v = makeView("say hello world", 4, 9, true);
    expect(insertLinkCommand(v)).toBe(false);
    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
    expect(promptSpy).not.toHaveBeenCalled();
  });
});

describe("D55 — the modal's log lines carry the mode", () => {
  it("D55-8 Source: open, submit and cancel log screen:'source'", async () => {
    const user = userEvent.setup();
    const v = makeView("say hello world", 4, 9);
    insertLinkCommand(v);
    const { unmount } = render(<LinkInsertModal />);
    await user.type(screen.getByLabelText("URL"), "a.io{Enter}");
    insertLinkCommand(v);
    await act(async () => {});
    await user.click(screen.getByLabelText("URL"));
    await user.keyboard("{Escape}");
    unmount();

    expect(linkLogs("ui.link-modal.open").map((e) => e.context?.screen)).toEqual([
      "source",
      "source",
    ]);
    expect(linkLogs("ui.link-modal.submit").map((e) => e.context?.screen)).toEqual(["source"]);
    expect(linkLogs("ui.link-modal.cancel").map((e) => e.context?.screen)).toEqual(["source"]);
  });

  it("D55-9 WYSIWYG keeps screen:'wysiwyg' when no mode is given", () => {
    act(() => useLinkInsertStore.getState().setPendingCallback(() => {}));
    render(<LinkInsertModal />);
    expect(linkLogs("ui.link-modal.open").map((e) => e.context?.screen)).toEqual(["wysiwyg"]);
    expect(useLinkInsertStore.getState().mode).toBe("wysiwyg");
  });
});

describe("D55 — Source mode mounts the modal", () => {
  it("D55-10 SplitView renders <LinkInsertModal />", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/components/Editor/SplitView.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/<LinkInsertModal\s*\/>/);
  });
});
