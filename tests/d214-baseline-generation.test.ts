/**
 * D214-WI-6 — audit Highs H-A and H-B on 0ae23ebe.
 *
 * jsdom, not node: the open guard's import chain (wholesaleReplace → … → exportService)
 * loads DOMPurify, which needs a DOM (the d20-open-write-guard tests run in jsdom too).
 *
 * H-A: the per-document baseline epoch repeated across a document's lifetimes:
 * `closeDocument` deleted the key, so a document reopened under the same path-derived
 * id restarted at 0. A save or reload reply held across close → reopen (with no drop,
 * or with one drop that lands on the same number as the captured one) passed the
 * `!==` check, restored a stale baseline, and the save deleted the draft.
 *
 * H-B: reopening an already-open clean tab went through `commitOpenedDocument`'s clean
 * upsert, so an external change recorded against that tab while `open_file` was in
 * flight (its `dropBaseline`) was undone: the tab read clean against stale bytes.
 *
 * Fix: one global, monotonic `baselineGeneration`. `dropBaseline` and `closeDocument`
 * stamp the document's epoch with a fresh generation; save, reload and the open paths
 * capture the generation before their IPC and treat "the document's epoch is greater
 * than the captured generation" as an external change in flight.
 *
 * Real stores, the real save / reload entry points and the real open guard. Boundaries
 * mocked: `@tauri-apps/api/core` (`invoke` routed, `save_file` / `reload_file` replies
 * held until released) and `@tauri-apps/api/window` (this window's label). The
 * `useDocument` open paths need React rendering, so they are pinned at source level:
 * each captures the generation before its IPC and passes it to the guard.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

import { saveActiveDocument } from "../src/services/documentSave";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { resetFileChanges } from "../src/stores/externalChangeStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { activeDocumentAfterFlush, decideCloseRequest } from "../src/utils/dataLossGuards";
import { commitOpenedDocument } from "../src/utils/openWriteGuard";
import { reloadActiveFromDisk } from "../src/utils/reloadTarget";

const PATH = "/tmp/a.md";
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
const doc = (id = "a") => store().getDocumentById(id)!;
const write = (content: string, id = "a") => store().updateDocumentContent(id, content);
const deleteDraftCalls = () => invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft").length;
/** What the open paths capture before their IPC (D214-WI-6). */
const generation = (): number => (store() as unknown as { baselineGeneration: number }).baselineGeneration;
const replaceDocument = (next: Document) => store().upsertDocument(next);

async function reply(cmd: string, value: unknown): Promise<void> {
  await vi.waitFor(() => expect(held.has(cmd)).toBe(true));
  const release = held.get(cmd)!;
  held.delete(cmd);
  release(value);
}
const requested = (cmd: string) => vi.waitFor(() => expect(held.has(cmd)).toBe(true));

/** Close document "a" and reopen it, clean, under the same id with `content`. */
function closeAndReopen(content: string): void {
  store().closeDocument("a");
  store().upsertDocument(D("a", content));
  useDocumentStore.setState({ activeDocumentId: "a" });
}

beforeEach(() => {
  invokeMock.mockClear();
  held.clear();
  resetFileChanges();
  // A fresh store per case: epochs left by an earlier case would make one pass by accident.
  useDocumentStore.setState({ documents: [], activeDocumentId: null, baselineEpoch: {} });
  useDocumentStore.setState({ baselineGeneration: 0 } as never);
  // Added in D214-WI-7: the path stamps are new state; resetting the generation to 0
  // without them would leave stamps from earlier cases above every fresh capture.
  useDocumentStore.setState({ baselinePathEpoch: {} } as never);
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("H-A a save reply held across close → reopen of the same id", () => {
  it.each([
    ["no drop at all", false],
    ["one drop in each lifetime (the epochs collide on 0ae23ebe)", true],
  ] as const)("%s: demoted, dirty with no baseline, draft kept", async (_label, dropInEachLifetime) => {
    store().upsertDocument(D("a", "OLD"));
    store().setActiveDocumentId("a");
    write("MID");
    if (dropInEachLifetime) store().dropBaseline("a");
    const saving = saveActiveDocument("act-save");
    await requested("save_file");
    closeAndReopen("MID");
    if (dropInEachLifetime) store().dropBaseline("a");
    await reply("save_file", { success: true, path: PATH, savedAt: SAVED_AT });
    await saving;

    expect([doc().isModified, doc().savedContent]).toEqual([true, undefined]);
    expect(deleteDraftCalls()).toBe(0);
    write("MID");
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
  });
});

describe("H-A a reload reply held across close → reopen of the same id", () => {
  it.each([
    ["no drop at all", false],
    ["one drop in each lifetime (the epochs collide on 0ae23ebe)", true],
  ] as const)("%s: goes in dirty with no baseline", async (_label, dropInEachLifetime) => {
    store().upsertDocument(D("a", "OLD"));
    store().setActiveDocumentId("a");
    if (dropInEachLifetime) store().dropBaseline("a");
    const reloading = reloadActiveFromDisk(PATH, replaceDocument, "act-reload");
    await requested("reload_file");
    closeAndReopen("OLD");
    if (dropInEachLifetime) store().dropBaseline("a");
    await reply("reload_file", D("a", "DISK1"));
    await reloading;

    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["DISK1", true, undefined]);
    write("DISK1");
    expect(doc().isModified).toBe(true);
  });
});

describe("H-B reopening an open clean tab while its file changed in flight", () => {
  it("id match: the decoded document goes in dirty with no baseline, and the log says why", () => {
    const log = vi.spyOn(loggingService, "logEventSync");
    store().upsertDocument(D("a", "A"));
    store().setActiveDocumentId("a");
    const startGeneration = generation(); // captured before open_file
    store().dropBaseline("a"); // an external change recorded while open_file was in flight

    const result = commitOpenedDocument(D("a", "DISK"), "file-open", { actionId: "act-open", startGeneration });

    expect(result.kind).toBe("written");
    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["DISK", true, undefined]);
    write("DISK");
    expect(doc().isModified).toBe(true);
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
    const reloadLine = log.mock.calls.map(([e]) => e).find((e) => e.event === "file.open.reload_clean");
    expect(reloadLine?.context).toMatchObject({
      documentId: "a",
      demoted: true,
      reason: "external_change_during_open",
    });
  });

  it("in-place path match (D145): written under the tab's id, dirty with no baseline", () => {
    store().upsertDocument(D("uuid-a", "A"));
    store().setActiveDocumentId("uuid-a");
    const startGeneration = generation();
    store().dropBaseline("uuid-a");

    const result = commitOpenedDocument(D("path-a", "DISK"), "encoding-reopen", { startGeneration });

    expect(result.document.id).toBe("uuid-a");
    expect([doc("uuid-a").isModified, doc("uuid-a").savedContent]).toEqual([true, undefined]);
    write("DISK", "uuid-a");
    expect(doc("uuid-a").isModified).toBe(true);
  });
});

describe("controls", () => {
  it("an open with nothing in flight still reads clean with the decoded baseline", () => {
    store().upsertDocument(D("a", "A"));
    store().setActiveDocumentId("a");
    const startGeneration = generation();
    commitOpenedDocument(D("a", "DISK"), "file-open", { startGeneration });
    expect([doc().isModified, doc().savedContent]).toEqual([false, "DISK"]);
  });

  it("a drop on another document during the open does not demote this one", () => {
    store().upsertDocument(D("a", "A"));
    store().upsertDocument(D("b", "B", { path: "/tmp/b.md" }));
    store().setActiveDocumentId("a");
    const startGeneration = generation();
    store().dropBaseline("b");
    commitOpenedDocument(D("a", "DISK"), "file-open", { startGeneration });
    expect([doc().isModified, doc().savedContent]).toEqual([false, "DISK"]);
  });

  it("a fresh open of a file not yet open reads clean", () => {
    const startGeneration = generation();
    const result = commitOpenedDocument(D("fresh", "NEW", { path: "/tmp/fresh.md" }), "file-open", {
      startGeneration,
    });
    expect(result.kind).toBe("written");
    expect([doc("fresh").isModified, doc("fresh").savedContent]).toEqual([false, "NEW"]);
  });
});

describe("the global baseline generation (store)", () => {
  it("never repeats across drops, close and reopen; each stamp is the new generation", () => {
    const stamps: number[] = [];
    store().upsertDocument(D("a", "A"));
    store().upsertDocument(D("b", "B", { path: "/tmp/b.md" }));
    store().dropBaseline("a");
    stamps.push(store().getBaselineEpoch("a"));
    expect(generation()).toBe(stamps[0]);
    store().dropBaseline("b");
    stamps.push(store().getBaselineEpoch("b"));
    store().closeDocument("a");
    stamps.push(store().getBaselineEpoch("a"));
    expect(generation()).toBe(stamps[2]);
    store().upsertDocument(D("a", "A"));
    store().dropBaseline("a");
    stamps.push(store().getBaselineEpoch("a"));
    expect(generation()).toBe(stamps[3]);

    expect(new Set(stamps).size).toBe(stamps.length);
    for (let i = 1; i < stamps.length; i += 1) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
  });
});

describe("source pin: every useDocument open path passes the generation it captured before its IPC", () => {
  const source = readFileSync(resolve(__dirname, "../src/hooks/useDocument.ts"), "utf8");

  it("capture → IPC → guard with startGeneration, three times, in that order", () => {
    const tokens = [
      ...source.matchAll(
        /(baselineGeneration)|(fileService\.openFile(?:Dialog)?\()|(commitOpenedDocument\([^)]*startGeneration[^)]*\))|(commitOpenedDocument\()/g,
      ),
    ].map((m) => (m[1] ? "capture" : m[2] ? "ipc" : m[3] ? "guard" : "unpinned-guard"));
    expect(tokens).toEqual(["capture", "ipc", "guard", "capture", "ipc", "guard", "capture", "ipc", "guard"]);
  });
});
