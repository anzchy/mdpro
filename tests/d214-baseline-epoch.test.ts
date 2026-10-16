// @vitest-environment node
/**
 * D214-WI-5 — audit High H-1: an external change recorded while a save or a reload is
 * in flight must not be overwritten by the reply's clean point.
 *
 * Race: edit to MID → save starts → another program writes the file and its change is
 * recorded (dropBaseline) BEFORE our `save_file` reply → the reply lands as `applied` →
 * before the fix: clean, baseline MID, draft deleted, so undoing back to MID read clean
 * while the disk held the other program's text. Same for a reload whose read was
 * overtaken by a newer change.
 *
 * Fix: documentStore keeps a per-document baseline epoch that `dropBaseline` bumps. A
 * save or reload captures it before its IPC; if it moved when the reply lands, the
 * result goes in dirty with no baseline (and a save keeps its draft).
 *
 * Real stores and the real save / reload entry points. Boundaries mocked:
 * `@tauri-apps/api/core` (`invoke` routed, with `save_file`, `save_file_dialog` and
 * `reload_file` replies held until the test releases them) and `@tauri-apps/api/window`
 * (this window's label, for the save-notice origin filter).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, held } = vi.hoisted(() => {
  const held = new Map<string, (value: unknown) => void>();
  const HELD = new Set(["save_file", "save_file_dialog", "reload_file"]);
  const invokeMock = vi.fn((cmd: string) => {
    if (HELD.has(cmd)) return new Promise((resolve) => held.set(cmd, resolve));
    return Promise.resolve(null);
  });
  return { invokeMock, held };
});

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string) => invokeMock(cmd),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { saveActiveDocument, saveActiveDocumentAs } from "../src/services/documentSave";
import { useDocumentStore } from "../src/stores/documentStore";
import { pendingFileChangeFor, recordFileChange, resetFileChanges } from "../src/stores/externalChangeStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { activeDocumentAfterFlush, decideCloseRequest } from "../src/utils/dataLossGuards";
import { reloadActiveFromDisk } from "../src/utils/reloadTarget";

const PATH = "/tmp/a.md";
const NEW_PATH = "/tmp/a-copy.md";
const SAVED_AT = 1_760_000_000_000;

function D(id: string, content: string, extra: Partial<Document> = {}): Document {
  return {
    id,
    path: PATH,
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
const doc = () => store().getDocumentById("a")!;
const write = (content: string) => store().updateDocumentContent("a", content);
const deleteDraftCalls = () => invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft").length;
const externalChange = (path = PATH) =>
  recordFileChange({ path, changeType: "modified", timestamp: 2 }, "act-ext");
/** The writer `useDocument.replaceDocument` performs: one upsert of the document. */
const replaceDocument = (next: Document) => store().upsertDocument(next);

/** Wait until `cmd` was requested, then answer it with `value`. */
async function reply(cmd: string, value: unknown): Promise<void> {
  await vi.waitFor(() => expect(held.has(cmd)).toBe(true));
  const resolve = held.get(cmd)!;
  held.delete(cmd);
  resolve(value);
}
const requested = (cmd: string) => vi.waitFor(() => expect(held.has(cmd)).toBe(true));

/** Clean "OLD" on disk, edited to "MID", active. */
function editedToMid(): void {
  store().upsertDocument(D("a", "OLD"));
  store().setActiveDocumentId("a");
  write("MID");
}

beforeEach(() => {
  invokeMock.mockClear();
  held.clear();
  resetFileChanges();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("a) save with an external change recorded before the reply", () => {
  it("stays dirty with no baseline, keeps the draft, and close prompts after undo", async () => {
    editedToMid();
    const saving = saveActiveDocument("act-save");
    await requested("save_file");
    externalChange();
    await reply("save_file", { success: true, path: PATH, savedAt: SAVED_AT });
    await saving;

    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["MID", true, undefined]);
    expect(doc().lastSaved).toBe(SAVED_AT);
    expect(deleteDraftCalls()).toBe(0);
    write("MID+1");
    write("MID");
    expect(doc().isModified).toBe(true);
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
  });
});

describe("b) reload overtaken by a newer external change", () => {
  it("goes in dirty with no baseline; the newer change stays pending; close prompts", async () => {
    store().upsertDocument(D("a", "OLD"));
    store().setActiveDocumentId("a");
    externalChange(); // the change the Reload prompt is about
    const reloading = reloadActiveFromDisk(PATH, replaceDocument, "act-reload");
    await requested("reload_file");
    externalChange(); // a newer change lands while the read is in flight
    const newer = pendingFileChangeFor("a")!.seq;
    await reply("reload_file", D("path-derived-a", "DISK1"));
    expect(await reloading).toEqual({ kind: "reloaded", documentId: "a" });

    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["DISK1", true, undefined]);
    expect(pendingFileChangeFor("a")?.seq).toBe(newer);
    write("DISK1");
    expect(doc().isModified).toBe(true);
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
  });
});

describe("c) nothing changes in flight", () => {
  it("a save ends clean with the written text as baseline and deletes the draft", async () => {
    editedToMid();
    const saving = saveActiveDocument("act-save");
    await reply("save_file", { success: true, path: PATH, savedAt: SAVED_AT });
    await saving;
    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["MID", false, "MID"]);
    expect(deleteDraftCalls()).toBe(1);
  });

  it("a reload ends clean with the reloaded text as baseline", async () => {
    store().upsertDocument(D("a", "OLD"));
    store().setActiveDocumentId("a");
    externalChange();
    const reloading = reloadActiveFromDisk(PATH, replaceDocument, "act-reload");
    await reply("reload_file", D("path-derived-a", "DISK1"));
    await reloading;
    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["DISK1", false, "DISK1"]);
  });
});

describe("d) Save As with an external change recorded before the reply", () => {
  it("moves the path but stays dirty with no baseline and keeps the draft", async () => {
    editedToMid();
    const saving = saveActiveDocumentAs("act-save-as");
    await requested("save_file_dialog");
    externalChange();
    await reply("save_file_dialog", { success: true, path: NEW_PATH, savedAt: SAVED_AT, changedSinceRead: false });
    await saving;
    expect([doc().path, doc().isModified, doc().savedContent]).toEqual([NEW_PATH, true, undefined]);
    expect(deleteDraftCalls()).toBe(0);
  });
});

describe("e) a recovered draft (no baseline) saved with nothing in flight", () => {
  it("ends clean with a baseline", async () => {
    store().upsertDocument(D("a", "DRAFT", { isModified: true }));
    store().setActiveDocumentId("a");
    const saving = saveActiveDocument("act-save");
    await reply("save_file", { success: true, path: PATH, savedAt: SAVED_AT });
    await saving;
    expect([doc().isModified, doc().savedContent]).toEqual([false, "DRAFT"]);
  });
});

describe("f) the baseline epoch in documentStore", () => {
  it("an unknown id reads 0", () => {
    expect(store().getBaselineEpoch("nobody")).toBe(0);
  });

  it("dropBaseline bumps it, even when the document has no baseline, per document", () => {
    store().upsertDocument(D("a", "A"));
    store().upsertDocument(D("b", "B", { path: "/tmp/b.md" }));
    const a0 = store().getBaselineEpoch("a");
    const b0 = store().getBaselineEpoch("b");
    store().dropBaseline("a");
    expect(store().getBaselineEpoch("a")).toBe(a0 + 1);
    expect(doc().savedContent).toBeUndefined();
    store().dropBaseline("a"); // already without a baseline: still bumps
    expect(store().getBaselineEpoch("a")).toBe(a0 + 2);
    expect(store().getBaselineEpoch("b")).toBe(b0);
  });

  it("closeDocument deletes the document's key", () => {
    store().upsertDocument(D("a", "A"));
    store().dropBaseline("a");
    expect(store().getBaselineEpoch("a")).toBeGreaterThan(0);
    store().closeDocument("a");
    expect(Object.prototype.hasOwnProperty.call(store().baselineEpoch, "a")).toBe(false);
    expect(store().getBaselineEpoch("a")).toBe(0);
  });
});
