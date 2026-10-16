// @vitest-environment node
/**
 * D214-WI-4 — an external change drops the saved-content baseline.
 *
 * Regression: edit (dirty) → another program modifies, deletes or creates the file →
 * the prompt is dismissed → undo back to the old text. With the old baseline the tab
 * read clean and close / quit did not prompt, but that text was no longer on disk.
 * Now every recorded content change (modified / deleted; a create reaches the frontend
 * as `modified`, `file_watcher_route.rs`) drops the baseline of each document it is
 * recorded against, and so does an open / Save As divergence (`recordOpenDivergence`).
 * A rename does not. `dropBaseline` never changes `isModified`; the next clean point
 * (a reload's clean upsert, a save) restores a baseline.
 *
 * Real documentStore, externalChangeStore and dataLossGuards. Boundaries mocked:
 * `@tauri-apps/api/core` (inert invoke) and `@tauri-apps/api/window` (this window's
 * label, read by the save-notice origin filter), as the D171 / D173 tests do.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { useDocumentStore } from "../src/stores/documentStore";
import {
  pendingFileChangeFor,
  recordFileChange,
  recordOpenDivergence,
  resetFileChanges,
} from "../src/stores/externalChangeStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import type { FileChangedEvent } from "../src/types/fileChange";
import {
  activeDocumentAfterFlush,
  assessWindowUnsaved,
  decideCloseRequest,
} from "../src/utils/dataLossGuards";

const THIS_WINDOW = "main";

function D(id: string, content: string, extra: Partial<Document> = {}): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...extra,
  };
}

const store = () => useDocumentStore.getState();
const doc = (id: string) => store().getDocumentById(id)!;
const write = (id: string, content: string) => store().updateDocumentContent(id, content);
const ev = (path: string, changeType: FileChangedEvent["changeType"], extra: Partial<FileChangedEvent> = {}) =>
  ({ path, changeType, timestamp: 1, ...extra }) as FileChangedEvent;

beforeEach(() => {
  resetFileChanges();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ flushers: {} });
});

/** Clean "A", edited to "AB" (dirty), `id` active or in the background. */
function editedTab(id: string, active: boolean): void {
  store().upsertDocument(D(id, "A"));
  store().upsertDocument(D("other", "O"));
  store().setActiveDocumentId(active ? id : "other");
  write(id, "AB");
}

describe("1–2 an external content change on the active tab drops its baseline", () => {
  // "created": Rust routes a `Create` on an existing path as `modified` (file_watcher_route.rs).
  it.each([
    ["modified", "modified"],
    ["deleted", "deleted"],
    ["created (arrives as modified)", "modified"],
  ] as const)("%s: undo back to the old text stays dirty and close prompts", (_label, changeType) => {
    editedTab("a", true);
    const result = recordFileChange(ev("/tmp/a.md", changeType), "act-1");
    expect(result.documentIds).toEqual(["a"]);
    expect(doc("a").savedContent).toBeUndefined();
    write("a", "A");
    expect(doc("a").isModified).toBe(true);
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
  });
});

describe("3 a background tab", () => {
  it("drops the baseline of a non-active document; the window exit lists it", () => {
    editedTab("a", false);
    const result = recordFileChange(ev("/tmp/a.md", "modified"), "act-1");
    expect(result).toMatchObject({ documentIds: ["a"], activeRecorded: false });
    write("a", "A");
    expect(doc("a").isModified).toBe(true);
    expect(assessWindowUnsaved("window-close").dirtyDocuments).toEqual([{ id: "a", path: "/tmp/a.md" }]);
    expect(doc("other").savedContent).toBe("O");
  });
});

describe("4 a rename keeps the baseline", () => {
  it("after a rename event, writing the saved text back reads clean", () => {
    editedTab("a", true);
    recordFileChange(ev("/tmp/a.md", "renamed", { newPath: "/tmp/a2.md" }), "act-1");
    expect(doc("a").savedContent).toBe("A");
    write("a", "A");
    expect(doc("a").isModified).toBe(false);
  });
});

describe("5 save notices (D173-WI-3)", () => {
  it("a save of the same path in another window drops the baseline", () => {
    editedTab("a", true);
    const notice = ev("/tmp/a.md", "modified", { origin: { windowLabel: "other-window", documentId: "a" } });
    expect(recordFileChange(notice, "act-1").documentIds).toEqual(["a"]);
    write("a", "A");
    expect(doc("a").isModified).toBe(true);
  });

  it("this document's own save notice records nothing and keeps the baseline", () => {
    editedTab("a", true);
    const notice = ev("/tmp/a.md", "modified", { origin: { windowLabel: THIS_WINDOW, documentId: "a" } });
    expect(recordFileChange(notice, "act-1")).toEqual({ documentIds: [], activeRecorded: false, ownSkipped: true });
    expect(pendingFileChangeFor("a")).toBeUndefined();
    expect(doc("a").savedContent).toBe("A");
    write("a", "A");
    expect(doc("a").isModified).toBe(false);
  });

  it("a same-path sibling of the saver in this window loses its baseline; the saver keeps it", () => {
    store().upsertDocument(D("a", "A"));
    store().upsertDocument(D("sib", "A", { path: "/tmp/a.md" }));
    write("sib", "AB");
    const notice = ev("/tmp/a.md", "modified", { origin: { windowLabel: THIS_WINDOW, documentId: "a" } });
    expect(recordFileChange(notice, "act-1").documentIds).toEqual(["sib"]);
    expect(doc("a").savedContent).toBe("A");
    expect(doc("sib").savedContent).toBeUndefined();
    write("sib", "A");
    expect(doc("sib").isModified).toBe(true);
  });
});

describe("6 an unedited clean document", () => {
  it("stays clean, with no baseline", () => {
    store().upsertDocument(D("a", "A"));
    recordFileChange(ev("/tmp/a.md", "modified"), "act-1");
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([false, undefined]);
    expect(pendingFileChangeFor("a")?.event.changeType).toBe("modified");
  });
});

describe("7 an open / Save As divergence", () => {
  it("recordOpenDivergence drops the baseline", () => {
    editedTab("a", true);
    expect(recordOpenDivergence("a", "act-1")).toBe(true);
    expect(doc("a").savedContent).toBeUndefined();
    write("a", "A");
    expect(doc("a").isModified).toBe(true);
  });
});

describe("8 a clean point after the drop restores a baseline", () => {
  it("a reload's clean upsert sets the baseline again; a write equal to it reads clean", () => {
    editedTab("a", true);
    recordFileChange(ev("/tmp/a.md", "modified"), "act-1");
    store().upsertDocument(D("a", "DISK"));
    expect(doc("a").savedContent).toBe("DISK");
    write("a", "DISK+1");
    write("a", "DISK");
    expect(doc("a").isModified).toBe(false);
  });
});

describe("documentStore.dropBaseline", () => {
  it.each([false, true])("touches only that document and never changes isModified (dirty=%s)", (dirty) => {
    store().upsertDocument(D("a", "A"));
    store().upsertDocument(D("b", "B"));
    if (dirty) write("a", "AB");
    const before = structuredClone(store().documents);
    store().dropBaseline("a");
    const [a, b] = store().documents;
    expect(a).toEqual({ ...before[0], savedContent: undefined });
    expect(a.isModified).toBe(dirty);
    expect(b).toEqual(before[1]);
  });

  it("an unknown id changes nothing", () => {
    store().upsertDocument(D("a", "A"));
    const before = store().documents;
    store().dropBaseline("missing");
    expect(store().documents).toEqual(before);
  });
});
