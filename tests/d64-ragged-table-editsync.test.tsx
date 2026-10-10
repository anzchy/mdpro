/**
 * D64 WI-2 through the REAL `MilkdownEditor` (so its `.use(tableParityPlugins)`
 * registration is what runs), the real edit-sync plugin, the real stores and the real
 * `useMcpEvents` listeners. Only process boundaries are mocked:
 * `@tauri-apps/api/{core,event,window}`, `loggingService`, and jsdom's missing
 * `IntersectionObserver`. Scaffolding follows tests/mcp-insert-wysiwyg-d35-editor.test.tsx.
 *
 * ADR-0067 Consequences: opening a ragged document writes nothing and leaves it clean
 * (the transformer dispatches no transaction, and the heading-ID init transaction is
 * suppressed by edit-sync); the FIRST edit writes the widened tables; every path that
 * rebuilds the PM doc from markdown (mount, remount, MCP write / insert / table action)
 * yields rectangular tables.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { eventListeners } = vi.hoisted(() => ({
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    eventListeners.set(name, cb);
    return () => eventListeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Editor } from "@milkdown/kit/core";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { findAllTables } from "../src/utils/cursorSync/table";
import { widenTable } from "../src/utils/tableWiden";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, typeAtEnd } from "./helpers/milkdownEditorHarness";
import { FIXTURE, FIXTURE_TAIL_WIDE, docOf, fromT1, posAfter, tWide, tableShapes, viewOf } from "./support/raggedTableD64";

const DELAY_MS = 200;
const SETTLE_MS = DELAY_MS + 150;
const REBUILD_TIMEOUT_MS = 3000;
const CASE_TIMEOUT_MS = 20_000;

/** The fixture as the serializer writes it once widened (measured load baseline). */
const FIXTURE_WIDE =
  "# D49 / D58 table check\n\n## T0 normal\n\n| n1 | n2 |\n| -- | -- |\n| a  | b  |\n| c  | d  |\n\n" +
  FIXTURE_TAIL_WIDE;
const SHORT_DOC = "Lead\n\n| a | b | c |\n|---|---|---|\n| x |\n| y | z | w |\n\nend\n";

const docA = () => docById("doc-a")!;
const liveEditor = () => useMilkdownEditorStore.getState().getEditor() as Editor | null;
const editorText = () => document.querySelector(".ProseMirror")?.textContent ?? "";

let unmountEditor: (() => void) | null = null;

async function mount(): Promise<Editor> {
  const mounted = await mountAndWait();
  unmountEditor = mounted.unmount;
  return mounted.instance;
}

async function unmount(): Promise<void> {
  await act(async () => {
    unmountEditor?.();
  });
  unmountEditor = null;
  await sleep(50);
}

async function emitMcp(name: string, payload: Record<string, unknown>): Promise<void> {
  renderHook(() => useMcpEvents());
  await act(async () => {});
  const handler = eventListeners.get(name);
  expect(handler, `no ${name} listener`).toBeTypeOf("function");
  await act(async () => {
    handler!({ payload });
  });
}

async function rebuiltEditorShowing(old: Editor, text: string): Promise<Editor> {
  let next: Editor | null = null;
  await waitFor(
    () => {
      expect(editorText()).toContain(text);
      next = liveEditor();
      expect(next).not.toBeNull();
      expect(next).not.toBe(old);
    },
    { timeout: REBUILD_TIMEOUT_MS },
  );
  await sleep(50);
  return next!;
}

function expectRectangular(e: Editor): void {
  const shapes = tableShapes(docOf(e));
  expect(shapes.length).toBeGreaterThan(0);
  for (const s of shapes) {
    expect(s.problems).toBeNull();
    for (const row of s.cells) expect(row).toHaveLength(s.width);
  }
}

beforeEach(() => {
  installIntersectionObserverDouble();
  eventListeners.clear();
  resetStores([makeDoc("doc-a", FIXTURE, "/tmp/a.md"), makeDoc("doc-b", "Other")]);
  useMilkdownEditorStore.setState({ editorGenerations: {} });
});

afterEach(async () => {
  unmountEditor?.();
  unmountEditor = null;
  await sleep(100);
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D64 load through the real MilkdownEditor", { timeout: CASE_TIMEOUT_MS }, () => {
  it("ES-1 the mounted editor's tables are rectangular (the component registers the transformer)", async () => {
    const e = await mount();
    expectRectangular(e);
    expect(tableShapes(docOf(e))[1].cells).toEqual([
      ["h1", "h2", "", ""],
      ["e", "f", "X1a", ""],
      ["g", "h", "X1b", "X1c"],
    ]);
  });

  it("ES-2 load-only: through the timer, heading-ID tr, flush and unmount the store is untouched and clean", async () => {
    await mount();
    await sleep(SETTLE_MS);
    expect(docA().content).toBe(FIXTURE);
    expect(docA().isModified).toBe(false);
    const flushed = useMilkdownEditorStore.getState().flushPendingEditsFor("doc-a", "test");
    expect(flushed.status).not.toBe("failed");
    expect(docA().content).toBe(FIXTURE);
    await unmount();
    expect(docA().content).toBe(FIXTURE);
    expect(docA().isModified).toBe(false);
  });

  it("ES-3 WYSIWYG → Source → WYSIWYG with no edit leaves the store unchanged and clean", async () => {
    await mount();
    await act(async () => {
      useEditorStore.getState().setViewMode("source");
    });
    await unmount();
    expect(docA().content).toBe(FIXTURE);
    await act(async () => {
      useEditorStore.getState().setViewMode("wysiwyg");
    });
    const again = await mount();
    expectRectangular(again);
    await sleep(SETTLE_MS);
    await act(async () => {
      useEditorStore.getState().setViewMode("source");
    });
    await unmount();
    expect(docA().content).toBe(FIXTURE);
    expect(docA().isModified).toBe(false);
  });

  it("ES-4 first-edit normalization: an edit outside every table writes the widened tables", async () => {
    const e = await mount();
    await act(async () => typeAtEnd(e, "Z"));
    expect(docA().isModified).toBe(true);
    await sleep(SETTLE_MS);
    expect(docA().content).toBe(FIXTURE_WIDE.replace("Last line.", "Last line.Z"));
    expect(docA().content).not.toContain("<br />");
    expect(docA().content).not.toMatch(/:-/);
  });

  it("ES-5 typing inside a ragged cell writes that cell in place and no other table changes", async () => {
    const e = await mount();
    await act(async () => {
      const view = viewOf(e);
      view.dispatch(view.state.tr.insertText("!", posAfter(view, "X2a")));
    });
    await sleep(SETTLE_MS);
    const content = docA().content;
    expect(widenTable(findAllTables(content)[2]).rows).toEqual([
      ["h1", "h2", "", ""],
      ["e", "f", "X2a!", ""],
      ["g", "h", "X2b", "X2c"],
    ]);
    expect(content).toContain(`## T1 wide\n\n${tWide(1)}\n`);
    expect(content).toContain(`## T3 wide\n\n${tWide(3)}\n`);
    expect(content).not.toContain("<br />");
  });

  it("ES-6 remount: a second mount of the same ragged document is rectangular and writes nothing", async () => {
    await mount();
    await unmount();
    const second = await mount();
    expectRectangular(second);
    await sleep(SETTLE_MS);
    expect(docA().content).toBe(FIXTURE);
    expect(docA().isModified).toBe(false);
  });
});

describe("D64 MCP paths through the real MilkdownEditor", { timeout: CASE_TIMEOUT_MS }, () => {
  it("ES-7 mcp:table_action set_cell on T0: the store's T1-T3 come back widened, not shifted", async () => {
    const e = await mount();
    await emitMcp("mcp:table_action", {
      document_id: "doc-a",
      action: "set_cell",
      payload: { tableIndex: 0, row: 1, col: 1, content: "R1" },
      window_label: null,
    });
    await sleep(SETTLE_MS);
    expectRectangular(e);
    expect(fromT1(docA().content)).toBe(FIXTURE_TAIL_WIDE);
    expect(docA().content).toContain("R1");
    expect(docA().content).not.toContain("<br />");
  });

  it("ES-8 mcp:write_document with ragged content rebuilds a rectangular editor", async () => {
    const old = await mount();
    await emitMcp("mcp:write_document", { document_id: "doc-a", content: SHORT_DOC, window_label: null });
    const next = await rebuiltEditorShowing(old, "Lead");
    expectRectangular(next);
    expect(tableShapes(docOf(next))[0].cells).toEqual([["a", "b", "c"], ["x", "", ""], ["y", "z", "w"]]);
    await sleep(SETTLE_MS);
    expect(docA().content).toBe(SHORT_DOC);
    await act(async () => typeAtEnd(next, "Z"));
    await sleep(SETTLE_MS);
    expect(docA().content).toBe("Lead\n\n| a | b | c |\n| - | - | - |\n| x |   |   |\n| y | z | w |\n\nendZ\n");
  });

  it("ES-9 mcp:insert_content into a ragged document rebuilds a rectangular editor", async () => {
    const old = await mount();
    await emitMcp("mcp:insert_content", {
      document_id: "doc-a",
      text: "MCP-START ",
      position: "start",
      window_label: null,
    });
    const next = await rebuiltEditorShowing(old, "MCP-START");
    expectRectangular(next);
    expect(tableShapes(docOf(next))).toHaveLength(4);
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("| e | f | X1a |\n| g | h | X1b | X1c |");
  });
});
