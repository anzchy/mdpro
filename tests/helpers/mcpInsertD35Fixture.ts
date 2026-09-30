/**
 * Purpose: shared fixture for the D35 unit files (`tests/mcp-insert-wysiwyg-d35*.test.ts`),
 * per matrix `.claude/tdd-guardian/tests-20260930-172500.md` §0 rule 6.
 *
 * Holds no mocks: `vi.mock` is hoisted per file, so each test file mocks
 * `@tauri-apps/api/*` and `loggingService` itself and hands its log spy to `logsOf`.
 * Every store, the edit-sync controller and `wholesaleReplace` are real.
 */
import type { Mock } from "vitest";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useEditorStore } from "../../src/stores/editorStore";
import { useMilkdownEditorStore } from "../../src/stores/milkdownEditorStore";
import { useTOCStore } from "../../src/stores/tocStore";
import { createEditSyncController } from "../../src/plugins/milkdown/editSync/controller";
import type { EditSyncController } from "../../src/plugins/milkdown/editSync/controller";
import type { InsertContentDeps, InsertContentEvent } from "../../src/hooks/mcpInsertContent";
import type { Document } from "../../src/types/document";

const TOC_INITIAL = useTOCStore.getState();

export const SECRET = "D35-SECRET-PAYLOAD";

export function makeDoc(id: string, content: string): Document {
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

/** Matrix §0 rule 6: doc-a "Hello world" active, doc-b "Other", WYSIWYG, no editors. */
export function resetFixture(docA = "Hello world", active = "doc-a"): void {
  useDocumentStore.setState({
    documents: [makeDoc("doc-a", docA), makeDoc("doc-b", "Other")],
    activeDocumentId: active,
  });
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: {} });
  useTOCStore.setState(TOC_INITIAL, true);
}

export const deps: InsertContentDeps = {
  currentWindowLabel: "main",
  updateDocumentContent: (id, c) => useDocumentStore.getState().updateDocumentContent(id, c),
};

export const gen = (id: string): number =>
  useMilkdownEditorStore.getState().editorGenerations[id] ?? 0;

export const content = (id: string): string | undefined =>
  useDocumentStore.getState().getDocumentById(id)?.content;

export function evt(
  text: string,
  position: InsertContentEvent["position"],
  overrides: Partial<InsertContentEvent> = {},
): InsertContentEvent {
  return { document_id: "doc-a", text, position, window_label: "main", ...overrides };
}

interface LogEntry {
  level?: string;
  event: string;
  status?: string;
  context?: Record<string, unknown>;
}

/** Every `logEventSync` argument whose `event` equals `name`. */
export function logsOf(spy: Mock, name: string): LogEntry[] {
  return spy.mock.calls.map((c) => c[0] as LogEntry).filter((e) => e.event === name);
}

/** A real controller for `id` with one pending user edit, registered as the live flusher. */
export function pending(id: string, getMarkdown: () => string): EditSyncController {
  const c = register(id, getMarkdown);
  c.onDocChanged({ userEdit: true });
  return c;
}

/** A real, clean controller for `id`, registered as the live flusher. */
export function register(id: string, getMarkdown: () => string): EditSyncController {
  const c = createEditSyncController({
    documentId: id,
    getMarkdown,
    baselineMarkdown: content(id) ?? "",
  });
  useMilkdownEditorStore.getState().registerFlusher(id, (r) => c.flush(r), c.discard);
  return c;
}
