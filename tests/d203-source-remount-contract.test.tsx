/**
 * D203 — what the per-document remount of the Source editor must keep (delegator's three
 * checks, 2026-10-14):
 * - C1 focus: a switch made while the Source editor had focus leaves the new view focused,
 *   so the next keystroke lands without a click; a switch made while it did not have focus
 *   does not steal it;
 * - C2 plugins: the registry's plugins are destroyed with the outgoing view and initialised
 *   once for the incoming one (no leak, no double registration), and the registry and the
 *   editor store point at the live view;
 * - C3 the accepted cost: cursor and scroll start at the top of a document on each switch
 *   (nothing restored them per document before; the old view kept a stale pixel offset).
 *
 * Same wiring as tests/d203-source-undo-across-tabs.test.tsx (App's Source branch through
 * the real `useDocument`). Mocked: `@tauri-apps/api/{core,event,window}` and
 * `loggingService` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { act, cleanup, render } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { SplitView } from "../src/components/Editor/SplitView";
import { useDocument } from "../src/hooks/useDocument";
import { pluginRegistry } from "../src/plugins";
import type { MdproPlugin } from "../src/plugins/core/pluginTypes";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { makeDoc } from "./helpers/milkdownEditorHarness";

const SMALL = "# small98\n\nshort body.\n";
const BIG = `# big98\n\n${"a long line of the big document\n".repeat(200)}`;
const SETTLE_MS = 300;
const PROBE = "d203-remount-probe";

type Api = ReturnType<typeof useDocument>;
let api: Api | null = null;

function Host() {
  api = useDocument();
  const active = api.activeDocument;
  return (
    <SplitView
      markdown={active?.content ?? ""}
      onChange={api.updateActiveDocumentContent}
      readOnly={!active}
    />
  );
}

const view = (): EditorView => {
  const v = useEditorStore.getState().editorView;
  if (!v) throw new Error("no Source editor view mounted");
  return v;
};
const content = (id: string) => useDocumentStore.getState().documents.find((d) => d.id === id)!.content;

function switchTo(id: string): void {
  act(() => {
    api!.setActiveDocumentById(id);
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  });
}

const counts = { init: 0, destroy: 0 };
const probe: MdproPlugin = {
  name: PROBE,
  displayName: "D203 remount probe",
  supportedModes: ["codemirror"],
  priority: 0,
  defaultConfig: { enabled: true, options: {} },
  init: () => {
    counts.init += 1;
  },
  destroy: () => {
    counts.destroy += 1;
  },
};

// jsdom has no Range layout; CodeMirror's rAF measure calls it on a live view (as in D55).
const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
let rangeShimmed: string[] = [];
let unmount: (() => void) | null = null;

beforeEach(async () => {
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof rangeProto[name] !== "function");
  for (const name of rangeShimmed) {
    rangeProto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
  counts.init = 0;
  counts.destroy = 0;
  pluginRegistry.register(probe);
  useDocumentStore.setState({
    documents: [makeDoc("small", SMALL, "/tmp/small98.md"), makeDoc("big", BIG, "/tmp/big98.md")],
    activeDocumentId: "small",
  });
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {}, viewMode: "source" });
  unmount = render(<Host />).unmount;
  await settle();
});

afterEach(() => {
  unmount?.();
  unmount = null;
  cleanup();
  pluginRegistry.unregister(PROBE);
  api = null;
  for (const name of rangeShimmed) delete rangeProto[name];
  rangeShimmed = [];
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {} });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D203 — the Source remount keeps focus, plugins and the live view straight", () => {
  it("C1a a switch made while the editor had focus leaves the new view focused; typing lands", async () => {
    act(() => view().focus());
    expect(view().hasFocus).toBe(true);
    switchTo("big");
    await settle();
    expect(view().hasFocus, "the incoming view took focus").toBe(true);
    expect(document.activeElement).toBe(view().contentDOM);
    act(() => {
      const v = view();
      v.dispatch({ changes: { from: v.state.doc.length, insert: "Y" }, userEvent: "input.type" });
    });
    await settle();
    expect(content("big")).toBe(`${BIG}Y`);
    expect(content("small")).toBe(SMALL);
  });

  it("C1b a switch made while focus was elsewhere does not steal it", async () => {
    const outside = document.body.appendChild(document.createElement("button"));
    act(() => outside.focus());
    switchTo("big");
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("C2 five switches: one live init, the rest destroyed; registry and store hold the live view", async () => {
    for (const id of ["big", "small", "big", "small", "big"]) {
      switchTo(id);
      await settle();
      expect(counts.init - counts.destroy, `after switching to ${id}`).toBe(1);
      expect(pluginRegistry.getContext().codemirror.getView()).toBe(view());
      expect(view().dom.isConnected).toBe(true);
      expect(document.querySelectorAll(".cm-editor")).toHaveLength(1);
      expect(view().state.doc.toString()).toBe(id === "big" ? BIG : SMALL);
    }
    unmount?.();
    unmount = null;
    expect(counts.init).toBe(counts.destroy);
  });

  it("C3 the cost: the incoming document opens with the cursor at the top", async () => {
    switchTo("big");
    await settle();
    act(() => view().dispatch({ selection: EditorSelection.cursor(40) }));
    switchTo("small");
    await settle();
    switchTo("big");
    await settle();
    expect(view().state.selection.main.head).toBe(0);
  });
});
