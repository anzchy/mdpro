/**
 * D235-WI-2: ⌘K opened Insert Link on top of an open modal. D235 refused
 * Insert Table and Preferences while a modal is open, but ⌘K never reaches
 * those dispatchers: both editors' own keymaps open Insert Link
 * (`typoraKeymapPlugin`'s `link` entry in WYSIWYG, `insertLinkCommand` in
 * Source). Each now refuses while a modal is open, Recovery included, with the
 * same `ui.dialog.open` cancel line, and still opens Insert Link when none is.
 *
 * Mock boundary: the Tauri core `invoke` (log capture). The real RecoveryDialog,
 * guard, link store, keymap entry, CodeMirror view and logger run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { EditorSelection, EditorState as CmState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState as PmState, TextSelection } from "@milkdown/kit/prose/state";

type LogPayload = { event?: string; status?: string; context?: Record<string, unknown> };

const { logs } = vi.hoisted(() => ({ logs: [] as LogPayload[] }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") logs.push((args.payload as LogPayload | undefined) ?? {});
    return null;
  },
}));

import { RecoveryDialog } from "../src/components/common/RecoveryDialog";
import { insertLinkCommand } from "../src/plugins/codemirror/linkPlugin";
import { TYPORA_KEYMAP_CONFIG } from "../src/plugins/milkdown/typoraKeymapPlugin";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const DRAFT = { id: "d1", originalPath: null, lastModified: "2026-10-15T00:00:00Z", recovered: false, title: "Untitled" };

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
  marks: { link: { attrs: { href: {} } } },
});

// jsdom has no Range layout; CodeMirror's measure pass calls it on a live view.
const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
let rangeShimmed: string[] = [];
let cm: EditorView | null = null;

function pressWysiwygModK(): void {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("hello")])]);
  const state = PmState.create({ doc, selection: TextSelection.create(doc, 1, 6) });
  const command = TYPORA_KEYMAP_CONFIG.link.command(undefined as never);
  act(() => void command(state, () => {}, undefined));
}

function pressSourceModK(): void {
  cm = new EditorView({
    state: CmState.create({ doc: "hello", selection: EditorSelection.single(0, 5) }),
    parent: document.body,
  });
  const view = cm;
  act(() => void insertLinkCommand(view));
}

const refusals = () =>
  logs.filter((l) => l.event === "ui.dialog.open" && l.status === "cancel" && l.context?.reason === "modal-open");

beforeEach(() => {
  logs.length = 0;
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof rangeProto[name] !== "function");
  for (const name of rangeShimmed) {
    rangeProto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
  useLoggingStore.setState({ enabled: true, level: "info" });
  useLinkInsertStore.setState({ pendingCallback: null, mode: "wysiwyg" });
});

afterEach(() => {
  cm?.destroy();
  cm = null;
  for (const name of rangeShimmed) delete rangeProto[name];
});

describe("D235-WI-2 ⌘K does not open Insert Link over an open modal", () => {
  it("L1 WYSIWYG ⌘K is refused while Recovery is open, with one log line", () => {
    render(<RecoveryDialog drafts={[DRAFT]} onRecover={() => {}} onDiscard={() => {}} />);
    pressWysiwygModK();

    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
    expect(refusals()).toHaveLength(1);
    expect(refusals()[0].context).toEqual({ action: "format.hyperlink", source: "shortcut", reason: "modal-open" });
  });

  it("L2 Source ⌘K is refused while Recovery is open, with one log line", () => {
    render(<RecoveryDialog drafts={[DRAFT]} onRecover={() => {}} onDiscard={() => {}} />);
    pressSourceModK();

    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
    expect(refusals()).toHaveLength(1);
    expect(refusals()[0].context).toEqual({ action: "format.hyperlink", source: "shortcut", reason: "modal-open" });
  });

  it("L3 with no modal open WYSIWYG ⌘K still opens Insert Link and logs no refusal", () => {
    pressWysiwygModK();
    expect(useLinkInsertStore.getState().pendingCallback).not.toBeNull();
    expect(refusals()).toEqual([]);
  });

  it("L4 with no modal open Source ⌘K still opens Insert Link and logs no refusal", () => {
    pressSourceModK();
    expect(useLinkInsertStore.getState().pendingCallback).not.toBeNull();
    expect(useLinkInsertStore.getState().mode).toBe("source");
    expect(refusals()).toEqual([]);
  });
});
