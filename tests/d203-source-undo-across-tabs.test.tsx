/**
 * D203 — in Source mode, ⌘Z after a tab switch must never bring another tab's text into the
 * active document. On the mini (0.3.3 candidate 50c67c5) small98.md → big98.md and one ⌘Z
 * turned the 10.4 MB big98 into small98's 27 bytes in the store, MCP and the draft.
 *
 * Mounts the REAL `SplitView` (real `Editor`, real `@uiw/react-codemirror`, real
 * extensions and keymaps) wired the way `App.tsx` wires it: `markdown` is the active
 * document's content and `onChange` is `useDocument().updateActiveDocumentContent`; a tab
 * switch is `useDocument().setActiveDocumentById`, the BottomTabs `onSelect`. Keys go
 * through `runScopeHandlers`, the path CodeMirror's own keydown listener takes. Typing is a
 * `input.type` transaction on the live view. Mocked: `@tauri-apps/api/{core,event,window}`
 * and `loggingService` only.
 *
 * Every assertion reads the document store (what MCP, drafts and ⌘S read) and the live
 * view (what the user sees).
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
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { SplitView } from "../src/components/Editor/SplitView";
import { useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { makeDoc } from "./helpers/milkdownEditorHarness";

const SMALL = "# small98\n\nshort body.\n";
const BIG = `# big98\n\n${"a long line of the big document\n".repeat(200)}`;
/** @uiw/react-codemirror defers an incoming `value` while the user typed in the last 200 ms. */
const TYPING_WINDOW_MS = 200;
const SETTLE_MS = TYPING_WINDOW_MS + 100;
/** CodeMirror's history merges changes closer than 500 ms (`newGroupDelay`) into one event. */
const APART_MS = 600;

type Api = ReturnType<typeof useDocument>;
let api: Api | null = null;

/** App.tsx's Source branch: SplitView on the active document, through the real hook. */
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
const modified = (id: string) =>
  useDocumentStore.getState().documents.find((d) => d.id === id)!.isModified;

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
function press(key: string, shift = false): void {
  act(() => {
    runScopeHandlers(
      view(),
      new KeyboardEvent("keydown", { key, shiftKey: shift, metaKey: mac, ctrlKey: !mac }),
      "editor",
    );
  });
}
const undo = () => press("z");
const redo = () => press("z", true);

/** A user keystroke: insert `text` at the end of the visible doc. */
function type(text: string): void {
  act(() => {
    const v = view();
    const end = v.state.doc.length;
    v.dispatch({ changes: { from: end, insert: text }, userEvent: "input.type" });
  });
}

function switchTo(id: string): void {
  act(() => {
    api!.setActiveDocumentById(id);
  });
}

async function settle(ms = SETTLE_MS): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Neither document may ever hold the other's text, and the view shows the active one. */
function expectNoCrossing(active: "small" | "big", small = SMALL, big = BIG): void {
  expect(content("small"), "small98 in the store").toBe(small);
  expect(content("big"), "big98 in the store").toBe(big);
  expect(view().state.doc.toString(), "the visible Source doc").toBe(active === "small" ? small : big);
}

// jsdom has no Range layout; CodeMirror's rAF measure calls it on a live view (as in D55).
const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
let rangeShimmed: string[] = [];

beforeEach(async () => {
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof rangeProto[name] !== "function");
  for (const name of rangeShimmed) {
    rangeProto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
  useDocumentStore.setState({
    documents: [makeDoc("small", SMALL, "/tmp/small98.md"), makeDoc("big", BIG, "/tmp/big98.md")],
    activeDocumentId: "small",
  });
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {}, viewMode: "source" });
  render(<Host />);
  await settle();
  expect(view().state.doc.toString()).toBe(SMALL);
});

afterEach(() => {
  cleanup();
  api = null;
  for (const name of rangeShimmed) delete rangeProto[name];
  rangeShimmed = [];
  useEditorStore.setState({ editorView: null, sourceTableVerdicts: {} });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D203 — undo and redo never carry text across a tab switch", () => {
  it("R1 the device case: small98 → big98, one ⌘Z leaves big98 whole", async () => {
    switchTo("big");
    await settle();
    expectNoCrossing("big");
    undo();
    await settle();
    expectNoCrossing("big");
    expect(modified("big"), "big98 dirtied by an undo it never had").toBe(false);
  });

  it("R2 ⌘Z then ⌘⇧Z after a switch changes neither document, at either step", async () => {
    switchTo("big");
    await settle();
    undo();
    await settle();
    expectNoCrossing("big");
    redo();
    await settle();
    expectNoCrossing("big");
  });

  it("R3 an edit in small98, a switch, then ⌘Z ×3 never reaches small98's text or edit", async () => {
    type("X");
    await settle();
    expect(content("small")).toBe(`${SMALL}X`);
    switchTo("big");
    await settle();
    for (let i = 0; i < 3; i += 1) {
      undo();
      await settle();
      expectNoCrossing("big", `${SMALL}X`);
    }
  });

  it("R4 a round trip small98 → big98 → small98, then ⌘Z ×2, brings no big98 text back at either step", async () => {
    switchTo("big");
    await settle(APART_MS);
    switchTo("small");
    await settle(APART_MS);
    for (let i = 0; i < 2; i += 1) {
      undo();
      await settle();
      expectNoCrossing("small");
    }
  });

  it("R5 a switch inside the typing window, then typing, writes only into the active document", async () => {
    type("X");
    switchTo("big");
    type("Y");
    await settle();
    expect(content("small"), "small98 keeps its own edit").toBe(`${SMALL}X`);
    expect(content("big"), "big98 gets only what was typed in it").toBe(`${BIG}Y`);
    expect(view().state.doc.toString()).toBe(`${BIG}Y`);
  });
});

describe("D203 — undo inside one tab still works", () => {
  it("G1 type in small98, ⌘Z reverts the typing, ⌘⇧Z brings it back", async () => {
    type("X");
    await settle();
    undo();
    await settle();
    expect(content("small")).toBe(SMALL);
    redo();
    await settle();
    expect(content("small")).toBe(`${SMALL}X`);
    expect(content("big")).toBe(BIG);
  });

  it("G2 after a switch, typing in big98 and ⌘Z reverts only that typing", async () => {
    switchTo("big");
    await settle();
    type("Y");
    await settle();
    expect(content("big")).toBe(`${BIG}Y`);
    undo();
    await settle();
    expectNoCrossing("big");
  });
});
