/**
 * D15 / D18 WI-2 — WYSIWYG edits reach documentStore, through the real editor.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-163219.md`, the P-* cases (WI-2). Seeded
 * from the diagnostic `tests/diag-d15-listener.test.tsx` (cases a-g), which WI-4 deletes.
 *
 * Mounts the REAL `MilkdownEditor` (real Milkdown, real ProseMirror, real serializer)
 * against the real documentStore, milkdownEditorStore, editorStore and tocStore, with
 * real timers. Only process boundaries are mocked: `@tauri-apps/api/{core,event,window}`
 * and `loggingService`, plus jsdom's missing `IntersectionObserver` (boundary double).
 *
 * Matrix §0.7: no case advances past the 200 ms delay unless it says so. "No timer
 * advance" reads run in the same `act`, or inside a `waitFor` of at most 150 ms.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";

const { logEventSyncMock, eventListeners } = vi.hoisted(() => ({
  logEventSyncMock: vi.fn(),
  eventListeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    eventListeners.set(name, cb);
    return () => eventListeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: (...args: unknown[]) => logEventSyncMock(...args),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { getMarkdown } from "@milkdown/kit/utils";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useTOCStore } from "../src/stores/tocStore";
import { useTOC } from "../src/hooks/useTOC";
import { useMcpEvents } from "../src/hooks/useMcpEvents";
import type { Document } from "../src/types/document";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";

const DELAY_MS = 200;
const SETTLE_MS = DELAY_MS + 150;
const LONG_CASE_MS = 30_000;
const TOC_INITIAL = useTOCStore.getState();

/** App.tsx calls useTOC with the active doc and renders <MilkdownEditor/> unmemoised,
 *  so a tocStore write re-renders MilkdownEditorInner (the D15 trigger). */
function AppLikeParent() {
  const doc = useDocumentStore((s) => s.documents.find((d) => d.id === s.activeDocumentId));
  useTOC({
    content: doc?.content ?? "",
    documentId: doc?.id ?? null,
    containerId: "milkdown-container",
    viewMode: "wysiwyg",
  });
  return <MilkdownEditor />;
}

function makeDoc(id: string, content: string): Document {
  return {
    id,
    path: null,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

function resetStores(docAContent = "Hello world"): void {
  useDocumentStore.setState({
    documents: [makeDoc("doc-a", docAContent), makeDoc("doc-b", "Other")],
    activeDocumentId: "doc-a",
  });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useTOCStore.setState(TOC_INITIAL, true);
}

async function sleep(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function mountAndWait(
  ui: JSX.Element = <MilkdownEditor />,
): Promise<{ instance: Editor; unmount: () => void }> {
  const { unmount } = render(ui);
  let instance: Editor | null = null;
  await waitFor(
    () => {
      instance = (useMilkdownEditorStore.getState().getEditor() as Editor | null) ?? null;
      expect(instance).not.toBeNull();
      expect(document.querySelector(".ProseMirror")).not.toBeNull();
    },
    { timeout: 5000 },
  );
  await sleep(50); // loading-flip re-render + effects
  return { instance: instance!, unmount };
}

function viewOf(instance: Editor): EditorView {
  return instance.action((ctx) => ctx.get(editorViewCtx));
}

function typeAtEnd(instance: Editor, text: string): void {
  const view = viewOf(instance);
  const end = view.state.doc.content.size - 1;
  view.dispatch(view.state.tr.insertText(text, end));
}

const docById = (id: string) => useDocumentStore.getState().documents.find((d) => d.id === id)!;
const docA = () => docById("doc-a");
const docB = () => docById("doc-b");
const hasFlusher = (id: string) =>
  Object.prototype.hasOwnProperty.call(useMilkdownEditorStore.getState().flushers, id);

/** Unmount the previous row's editor, let its async destroy finish, reset the stores. */
async function nextRow(unmount: (() => void) | null, docAContent?: string): Promise<void> {
  if (unmount) {
    unmount();
    await sleep(100);
  }
  resetStores(docAContent);
}

beforeEach(() => {
  eventListeners.clear();
  // jsdom has no IntersectionObserver; the real useTOC scroll spy needs one once a
  // document has headings. Boundary double, removed by `unstubGlobals`.
  installIntersectionObserverDouble();
  resetStores();
});

afterEach(async () => {
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("P — WYSIWYG edits persist (D15)", () => {
  it("P-a one edit persists without a re-render", async () => {
    const { instance } = await mountAndWait();
    await act(async () => typeAtEnd(instance, "XYZ"));
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("XYZ");
    expect(docA().isModified).toBe(true);
  });

  it("P-b an unrelated store change before the edit still persists", async () => {
    const { instance } = await mountAndWait();
    await act(async () => {
      useDocumentStore.getState().markDocumentModified("doc-b", true);
    });
    await act(async () => typeAtEnd(instance, "XYZ"));
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("XYZ");
  });

  it(
    "P-rerender the number of re-renders does not matter (L-P1)",
    async () => {
      let unmount: (() => void) | null = null;
      for (const k of [0, 1, 5, 20]) {
        await nextRow(unmount);
        let renders = 0;
        const mounted = await mountAndWait(
          <Profiler id="milkdown" onRender={() => (renders += 1)}>
            <MilkdownEditor />
          </Profiler>,
        );
        unmount = mounted.unmount;
        const before = renders;
        for (let i = 0; i < k; i++) {
          await act(async () => {
            useDocumentStore.getState().markDocumentModified("doc-b", i % 2 === 0);
          });
        }
        expect(renders - before, `k=${k}: re-renders did not happen`).toBeGreaterThanOrEqual(k);
        await act(async () => typeAtEnd(mounted.instance, `K${k}`));
        await sleep(SETTLE_MS);
        expect(docA().content, `k=${k}`).toContain(`K${k}`);
      }
    },
    LONG_CASE_MS,
  );

  it("P-c two edits separated by the delay both persist", async () => {
    const { instance } = await mountAndWait();
    await act(async () => typeAtEnd(instance, "ONE"));
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("ONE");
    await act(async () => typeAtEnd(instance, "TWO"));
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("ONE");
    expect(docA().content).toContain("TWO");
  });

  it("P-g App-like parent with real useTOC: the first keystroke after 500 ms persists", async () => {
    const { instance } = await mountAndWait(<AppLikeParent />);
    await sleep(500);
    await act(async () => typeAtEnd(instance, "F"));
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("F");
  });

  it("P-dirty-immediate dirty in the same act, content after the delay", async () => {
    const { instance } = await mountAndWait();
    await act(async () => typeAtEnd(instance, "Q"));
    expect(docA().isModified).toBe(true);
    expect(docA().content).not.toContain("Q");
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("Q");
  });
});

describe("P — loading and non-edits are no-ops (L-P3)", () => {
  const ROWS = [
    "Hello world",
    "# Guide\n\n## Intro\n\ntext\n",
    "| a | b |\n| - | - |\n| 1 | 22222 | 3 |\n",
    "---\ntitle: x\n---\n\n# H\n",
  ];
  const ALL = [...ROWS, ROWS.join("\n")];

  it(
    "P-clean-open opening heading / ragged table / frontmatter documents stays clean and byte-identical",
    async () => {
      let unmount: (() => void) | null = null;
      for (const [i, seed] of ALL.entries()) {
        await nextRow(unmount, seed);
        const before = docA();
        const mounted = await mountAndWait(<AppLikeParent />);
        unmount = mounted.unmount;
        await sleep(800);
        const row = `row=${i + 1} seed=${JSON.stringify(seed)}`;
        if (i === 1) {
          expect(document.querySelector(".ProseMirror h2[id]"), `${row}: heading ids never synced`)
            .not.toBeNull();
        }
        expect(docA().content, row).toBe(seed);
        expect(docA().isModified, row).toBe(false);
        expect(docA(), `${row}: doc object replaced`).toBe(before);
      }
    },
    LONG_CASE_MS,
  );

  it("P-selection-only selection and stored-marks dispatches do not dirty", async () => {
    const before = docA();
    const { instance } = await mountAndWait();
    const view = viewOf(instance);
    await act(async () => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    });
    await act(async () => {
      view.dispatch(view.state.tr.setStoredMarks([view.state.schema.marks.strong.create()]));
    });
    await sleep(SETTLE_MS);
    const result = useMilkdownEditorStore.getState().flushPendingEdits("save");
    expect(docA().isModified).toBe(false);
    expect(docA()).toBe(before);
    expect(result).toEqual({ status: "clean" });
  });

  it("P-heading-id-meta a history-less attribute-only change is not dirty", async () => {
    resetStores("# Title\n");
    const { instance } = await mountAndWait();
    const view = viewOf(instance);
    await act(async () => {
      const node = view.state.doc.firstChild!;
      view.dispatch(
        view.state.tr
          .setNodeMarkup(0, undefined, { ...node.attrs, id: "custom-x" })
          .setMeta("addToHistory", false),
      );
    });
    await sleep(SETTLE_MS);
    const result = useMilkdownEditorStore.getState().flushPendingEdits("save");
    expect(docA().isModified).toBe(false);
    expect(docA().content).toBe("# Title\n");
    expect(result).toEqual({ status: "clean" });
  });

  it("P-hist-text a history-less text change is written, and dirties only at write time", async () => {
    const { instance } = await mountAndWait();
    const view = viewOf(instance);
    await act(async () => {
      const end = view.state.doc.content.size - 1;
      view.dispatch(view.state.tr.insertText("PROG", end).setMeta("addToHistory", false));
    });
    expect(docA().isModified).toBe(false);
    await sleep(SETTLE_MS);
    expect(docA().content).toContain("PROG");
    expect(docA().isModified).toBe(true);
  });

  it("P-mixed-batch a user edit that triggers a history-less heading-id sync is a user edit", async () => {
    resetStores("# T\n");
    const { instance } = await mountAndWait();
    await act(async () => typeAtEnd(instance, "x"));
    expect(docA().isModified).toBe(true);
  });

  it("P-mcp-replaceall a programmatic replaceAll persists the serialized form and is dirty", async () => {
    resetStores("# New\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    const { instance } = await mountAndWait();
    renderHook(() => useMcpEvents());
    await act(async () => {});
    const handler = eventListeners.get("mcp:table_action");
    expect(handler, "no mcp:table_action listener").toBeTypeOf("function");
    await act(async () => {
      handler!({
        payload: {
          document_id: "doc-a",
          action: "set_cell",
          payload: { row: 1, col: 0, content: "X" },
          window_label: null,
        },
      });
    });
    await sleep(SETTLE_MS);
    useMilkdownEditorStore.getState().flushPendingEdits("save");
    const live = instance.action(getMarkdown());
    expect(live).toContain("X");
    expect(docA().content).toBe(live);
    expect(docA().content).toContain("# New");
    expect(docA().isModified).toBe(true);
  });
});

describe("P — owner binding and teardown (L-P2, D18)", () => {
  it(
    "P-e an old editor never writes the new document, at any switch delay",
    async () => {
      let unmount: (() => void) | null = null;
      for (const d of [0, 50, 150, 199, 250]) {
        await nextRow(unmount);
        const mounted = await mountAndWait();
        unmount = mounted.unmount;
        await act(async () => typeAtEnd(mounted.instance, "LATE"));
        if (d > 0) await sleep(d);
        await act(async () => {
          useDocumentStore.setState({ activeDocumentId: "doc-b" });
        });
        await sleep(400);
        expect(docB().content, `d=${d}`).toBe("Other");
        expect(docB().isModified, `d=${d}`).toBe(false);
      }
    },
    LONG_CASE_MS,
  );

  it("P-f (D18) edit then switch in the same tick: the old doc keeps the edit, no error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { instance } = await mountAndWait();
    await act(async () => {
      typeAtEnd(instance, "LATE");
      useDocumentStore.setState({ activeDocumentId: "doc-b" });
    });
    await waitFor(() => expect(docA().content).toContain("LATE"), { timeout: 150 });
    // Let any stale debounce from the old editor fire before scanning for errors.
    await sleep(SETTLE_MS);
    expect(consoleError).not.toHaveBeenCalled();
    const editorErrors = logEventSyncMock.mock.calls
      .map(([payload]) => payload as { level?: string; status?: string })
      .filter((p) => p.status === "fail" || p.level === "error")
      .filter((p) => /editorView|MilkdownError/.test(JSON.stringify(p)));
    expect(editorErrors).toEqual([]);
    expect(docB().content).toBe("Other");
    expect(docB().isModified).toBe(false);
  });

  it("P-flush-save flushPendingEdits right after typing writes synchronously", async () => {
    const { instance } = await mountAndWait();
    let first: unknown;
    await act(async () => {
      typeAtEnd(instance, "S1");
      first = useMilkdownEditorStore.getState().flushPendingEdits("save");
      expect(docA().content).toContain("S1");
    });
    expect(first).toEqual({ status: "written" });
    expect(useMilkdownEditorStore.getState().flushPendingEdits("save")).toEqual({
      status: "clean",
    });
  });

  it("P-unmount unmount after typing writes exactly once, never throws, and deregisters", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { instance, unmount } = await mountAndWait();
    expect(hasFlusher("doc-a"), "the plugin never registered a flusher").toBe(true);

    let contentWrites = 0;
    const unsubscribe = useDocumentStore.subscribe((state, prev) => {
      const now = state.documents.find((d) => d.id === "doc-a");
      const was = prev.documents.find((d) => d.id === "doc-a");
      if (now && was && now !== was && now.content !== was.content) contentWrites += 1;
    });
    try {
      await act(async () => {
        typeAtEnd(instance, "U");
        expect(() => unmount()).not.toThrow();
      });
      await sleep(600);
    } finally {
      unsubscribe();
    }

    expect(docA().content).toContain("U");
    expect(contentWrites).toBe(1);
    expect(consoleError).not.toHaveBeenCalled();
    expect(hasFlusher("doc-a"), "the plugin leaked its flusher registration").toBe(false);
    expect(useMilkdownEditorStore.getState().flushPendingEdits("save")).toEqual({
      status: "clean",
    });
  });
});
