/**
 * D35 — an MCP `insert_content` into a WYSIWYG-active document reaches Milkdown.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-172500.md` (Revision 2), cases D35-1..D35-10.
 * The exhaustive law D35-L and the hook wrapper case D35-HOOK live in
 * `mcp-insert-wysiwyg-d35-law.test.ts` (split only to keep each file under 300 lines);
 * D35-INT-1/2 in `mcp-insert-wysiwyg-d35-editor.test.tsx`.
 *
 * Ground rule 0.7: every `processInsertContentEvent` call is synchronous, with no await
 * or timer advance between it and its first assertions.
 * Mocks: `@tauri-apps/api/{core,event,window}` and `loggingService` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  logSpy: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock(),
);
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: (...args: unknown[]) => hoisted.logSpy(...args),
    logEvent: async () => undefined,
    generateActionId: () => "test-action-id",
  },
}));

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { processInsertContentEvent, type InsertPosition } from "../src/hooks/mcpInsertContent";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import { EDIT_SYNC_DELAY_MS } from "../src/plugins/milkdown/editSync/controller";
import { asAnchorSlug } from "../src/types/toc";
import {
  SECRET, content, deps, evt, gen, logsOf, pending, register, resetFixture,
} from "./helpers/mcpInsertD35Fixture";

const logs = (name: string) => logsOf(hoisted.logSpy, name);
const noLeak = () => expect(JSON.stringify(hoisted.logSpy.mock.calls)).not.toContain(SECRET);
const throwing = () => {
  throw new Error("serializer down");
};
const FLUSH_FAILED = (documentId: string) => ({
  level: "warn", event: "mcp.insert", status: "fail",
  context: { documentId, reason: "flush failed" },
});

let view: EditorView | null = null;

beforeEach(() => {
  resetFixture();
  hoisted.logSpy.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  view?.destroy();
  view = null;
});

function sourceView(doc: string, anchor: number): EditorView {
  view = new EditorView({ state: EditorState.create({ doc, selection: { anchor } }), parent: document.body });
  useEditorStore.setState({ viewMode: "source", editorView: view });
  return view;
}

describe("D35-1 WYSIWYG-active insert splices and bumps the generation once, synchronously", () => {
  const rows: Array<[string, InsertPosition, string]> = [
    ["start", "start", "[T]Hello world"],
    ["end", "end", "Hello world[T]"],
    ["interior 5", 5, "Hello[T] world"],
    ["past-end 999", 999, "Hello world[T]"],
    ["cursor (known D10(c) gap: resolves to 0)", "cursor", "[T]Hello world"],
  ];
  for (const [label, position, expected] of rows) {
    it(label, () => {
      const r = processInsertContentEvent(evt("[T]", position), deps);
      expect(r).toBeUndefined();
      expect(content("doc-a")).toBe(expected);
      expect(gen("doc-a")).toBe(1);
      expect(gen("doc-b")).toBe(0);
    });
  }
});

describe("D35-2 the pre-insert editor cannot overwrite the inserted text afterwards", () => {
  it("the stale controller is destroyed and the store keeps the insert", () => {
    vi.useFakeTimers();
    const c = register("doc-a", () => "Hello world");
    const r = processInsertContentEvent(evt(" +MCP", "end"), deps);
    expect(r).toBeUndefined();
    const changed = c.onDocChanged({ userEdit: true });
    const flushed = c.flush("save");
    const aggregate = useMilkdownEditorStore.getState().flushPendingEdits("save");
    vi.advanceTimersByTime(EDIT_SYNC_DELAY_MS * 2);
    expect(content("doc-a")).toBe("Hello world +MCP");
    expect(changed).toEqual({ status: "destroyed" });
    expect(flushed).toEqual({ status: "destroyed" });
    expect(aggregate).toEqual({ status: "clean" });
  });
});

describe("D35-3 a pending WYSIWYG edit is flushed first; the insert is relative to it", () => {
  for (const [position, expected] of [["end", "Hello world edited[T]"], [5, "Hello[T] world edited"]] as const) {
    it(`position ${position}`, () => {
      vi.useFakeTimers();
      pending("doc-a", () => "Hello world edited");
      processInsertContentEvent(evt("[T]", position), deps);
      expect(content("doc-a")).toBe(expected);
      expect(gen("doc-a")).toBe(1);
      const flush = logs("editor.milkdown.flush");
      expect(flush.some((e) => e.context?.reason === "mcp-insert" && e.context?.outcome === "written")).toBe(true);
      const reload = logs("editor.milkdown.reload");
      expect(reload).toHaveLength(1);
      expect(reload[0].context?.droppedPendingEdit).toBe(false);
    });
  }
});

describe("D35-4 source-mode active insert keeps the CodeMirror path and does not rebuild", () => {
  for (const [position, expected, head] of [["cursor", "HelloX world", 6], [999, "Hello worldX", 12]] as const) {
    it(`position ${position}`, () => {
      const v = sourceView("Hello world", 5);
      processInsertContentEvent(evt("X", position), deps);
      expect(content("doc-a")).toBe(expected);
      expect(v.state.doc.toString()).toBe(expected);
      expect(v.state.selection.main.head).toBe(head);
      expect(gen("doc-a")).toBe(0);
      expect(logs("editor.milkdown.reload")).toHaveLength(0);
    });
  }

  it("D35-4b source mode with no live view is still not a wholesale insert", () => {
    useEditorStore.setState({ viewMode: "source", editorView: null });
    processInsertContentEvent(evt("X", "end"), deps);
    expect(content("doc-a")).toBe("Hello worldX");
    expect(gen("doc-a")).toBe(0);
  });
});

describe("D35-5 a non-active target is appended, not rebuilt; the active pending edit is untouched", () => {
  it("cursor resolves to end and doc-b's controller is neither flushed nor discarded", () => {
    vi.useFakeTimers();
    resetFixture("Hello world", "doc-b");
    const cB = pending("doc-b", () => "Other typed");
    processInsertContentEvent(evt("[T]", "cursor"), deps);
    expect(content("doc-a")).toBe("Hello world[T]");
    expect(content("doc-b")).toBe("Other");
    expect(gen("doc-a")).toBe(0);
    expect(gen("doc-b")).toBe(0);
    expect(cB.flush("probe")).toEqual({ status: "written" });
    expect(content("doc-b")).toBe("Other typed");
  });
});

describe("D35-6 a failed flush refuses the insert and leaves everything as it was", () => {
  it("D35-6 the target's own flush fails", () => {
    vi.useFakeTimers();
    const toc = useTOCStore.getState();
    toc.setEntries([
      { anchorSlug: asAnchorSlug("guide"), level: 1, text: "Guide", lineNumber: 1, offset: 0 },
      { anchorSlug: asAnchorSlug("intro"), level: 2, text: "Intro", lineNumber: 3, offset: 10 },
    ], "doc-a");
    const k = useTOCStore.getState().entries[1].key;
    useTOCStore.getState().toggleCollapsed(k);
    const c = pending("doc-a", throwing);
    processInsertContentEvent(evt(SECRET, "end"), deps);
    expect(content("doc-a")).toBe("Hello world");
    expect(gen("doc-a")).toBe(0);
    expect(c.onDocChanged({ userEdit: true })).toEqual({ status: "scheduled" });
    expect(useTOCStore.getState().collapsedIds.has(k)).toBe(true);
    const insertLogs = logs("mcp.insert");
    expect(insertLogs).toHaveLength(1);
    expect(insertLogs[0]).toEqual(FLUSH_FAILED("doc-a"));
    expect(logs("editor.milkdown.reload")).toHaveLength(0);
    noLeak();
  });

  it("D35-6b a DIFFERENT document's failed flush also refuses (global flush)", () => {
    vi.useFakeTimers();
    pending("doc-b", throwing);
    processInsertContentEvent(evt(SECRET, "end"), deps);
    expect(content("doc-a")).toBe("Hello world");
    expect(gen("doc-a")).toBe(0);
    const insertLogs = logs("mcp.insert");
    expect(insertLogs).toHaveLength(1);
    expect(insertLogs[0]).toEqual(FLUSH_FAILED("doc-a"));
    noLeak();
  });
});

describe("D35-7 reload logged once as mcp-insert; wholesale flag tracks active-and-WYSIWYG", () => {
  const rows = [
    { label: "(a) active WYSIWYG", setup: () => {}, gen: 1, wholesale: true },
    { label: "(b) active source, null view", setup: () => useEditorStore.setState({ viewMode: "source", editorView: null }), gen: 0, wholesale: false },
    { label: "(c) doc-b active, WYSIWYG", setup: () => useDocumentStore.setState({ activeDocumentId: "doc-b" }), gen: 0, wholesale: false },
  ];
  for (const row of rows) {
    it(row.label, () => {
      row.setup();
      processInsertContentEvent(evt(SECRET, "end"), deps);
      expect(gen("doc-a")).toBe(row.gen);
      expect(gen("doc-b")).toBe(0);
      const reload = logs("editor.milkdown.reload");
      expect(reload).toHaveLength(row.gen);
      if (row.gen === 1) {
        expect(reload[0].context).toMatchObject({ reason: "mcp-insert", documentId: "doc-a", generation: 1 });
      }
      const success = logs("mcp.insert").filter((e) => e.status === "success");
      expect(success).toHaveLength(1);
      expect(success[0].context).toEqual({ documentId: "doc-a", wholesale: row.wholesale });
      noLeak();
    });
  }
});

describe("D35-8 guards run before any flush", () => {
  it("(a) a foreign window label is a no-op", () => {
    vi.useFakeTimers();
    const c = pending("doc-a", () => "Hello world edited");
    processInsertContentEvent(evt("[T]", "end", { window_label: "other-window" }), deps);
    expect(content("doc-a")).toBe("Hello world");
    expect(gen("doc-a")).toBe(0);
    expect(gen("doc-b")).toBe(0);
    expect(c.flush("probe")).toEqual({ status: "written" });
  });

  it("(b) an unknown document is a no-op with the not-found log", () => {
    vi.useFakeTimers();
    const c = pending("doc-a", () => "Hello world edited");
    processInsertContentEvent(evt(SECRET, "end", { document_id: "doc-missing" }), deps);
    expect(content("doc-a")).toBe("Hello world");
    expect(gen("doc-a")).toBe(0);
    expect(gen("doc-b")).toBe(0);
    const insertLogs = logs("mcp.insert");
    expect(insertLogs).toHaveLength(1);
    expect(insertLogs[0]).toEqual({
      level: "warn", event: "mcp.insert", status: "fail",
      context: { documentId: "doc-missing", reason: "not found" },
    });
    noLeak();
    expect(c.flush("probe")).toEqual({ status: "written" });
  });

  it("(c) a null window label means any window and is processed", () => {
    vi.useFakeTimers();
    pending("doc-a", () => "Hello world edited");
    processInsertContentEvent(evt("[T]", "end", { window_label: null }), deps);
    expect(content("doc-a")).toBe("Hello world edited[T]");
    expect(gen("doc-a")).toBe(1);
  });
});

describe("D35-9 consecutive WYSIWYG inserts", () => {
  it("strictly monotonic generation; a discarded registration never blocks the next insert", () => {
    vi.useFakeTimers();
    const c1 = register("doc-a", () => content("doc-a") ?? "");
    processInsertContentEvent(evt(" one", "end"), deps);
    expect(gen("doc-a")).toBe(1);
    processInsertContentEvent(evt(" two", "end"), deps);
    expect(gen("doc-a")).toBe(2);
    pending("doc-a", () => "Hello world one two typed");
    processInsertContentEvent(evt(" three", "end"), deps);
    expect(gen("doc-a")).toBe(3);
    expect(content("doc-a")).toBe("Hello world one two typed three");
    expect(logs("mcp.insert").filter((e) => e.status === "fail")).toHaveLength(0);
    expect(c1.onDocChanged({ userEdit: true })).toEqual({ status: "destroyed" });
  });
});

describe("D35-10 the flush is gated to WYSIWYG-active inserts", () => {
  const rows = [
    { label: "(a) active source, null view", setup: () => useEditorStore.setState({ viewMode: "source", editorView: null }) },
    { label: "(b) doc-b active, WYSIWYG, insert into doc-a", setup: () => useDocumentStore.setState({ activeDocumentId: "doc-b" }) },
  ];
  for (const row of rows) {
    it(row.label, () => {
      vi.useFakeTimers();
      pending("doc-b", throwing);
      row.setup();
      processInsertContentEvent(evt("X", "end"), deps);
      expect(content("doc-a")).toBe("Hello worldX");
      expect(logs("mcp.insert").filter((e) => e.status === "fail")).toHaveLength(0);
      expect(logs("editor.milkdown.flush").filter((e) => e.status === "fail")).toHaveLength(0);
    });
  }
});
