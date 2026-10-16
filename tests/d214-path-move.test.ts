/**
 * D214-WI-8 — codex-audit H-B PARTIAL on 1f3cf38d: a tab whose path moves while an open
 * is in flight.
 *
 * Trace: an open of P is held → P is renamed to Q and Q modified; the UUID tab follows
 * to Q (`externalChangeStore` → `updateDocumentPaths`) and the drop stamps uuid + Q,
 * never P → the user closes the tab → the P reply (id hash(P), path P) matches nothing
 * stamped and goes in clean with a stale baseline.
 *
 * Fix: one choke point in documentStore. Every mutator that changes an existing
 * document's path (`updateDocumentPath`, `updateDocumentPaths`, a path-changing
 * `upsertDocument`) stamps the old AND the new path with the next generation. The old
 * path closes the P reply; the new path closes the mirror (a held open of Q while a tab
 * moves onto Q). Accepted cost: a Save As or rename during an open of either path
 * demotes that open (a false dirty, never a loss).
 *
 * No store mutator swaps a document's id (the inventory found none): the last describe
 * pins that, and that the one removal, `closeDocument`, stamps the old id.
 *
 * jsdom: the guard's import chain loads DOMPurify. Real stores, the real guard, the real
 * externalChangeStore and the real Save As body. Boundaries mocked:
 * `@tauri-apps/api/core` (`invoke` routed; `save_file_dialog` held until released) and
 * `@tauri-apps/api/window`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, held } = vi.hoisted(() => {
  const held = new Map<string, (value: unknown) => void>();
  const invokeMock = vi.fn((cmd: string) => {
    if (cmd === "save_file_dialog") return new Promise((resolve) => held.set(cmd, resolve));
    return Promise.resolve(null);
  });
  return { invokeMock, held };
});

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string) => invokeMock(cmd),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { saveActiveDocumentAs } from "../src/services/documentSave";
import { useDocumentStore } from "../src/stores/documentStore";
import { recordFileChange, resetFileChanges } from "../src/stores/externalChangeStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { activeDocumentAfterFlush, decideCloseRequest } from "../src/utils/dataLossGuards";
import { commitOpenedDocument } from "../src/utils/openWriteGuard";

const P = "/tmp/p.md";
const Q = "/tmp/q.md";
const HASH_P = "path-derived-p";
const HASH_Q = "path-derived-q";

function D(id: string, path: string | null, content: string, extra: Partial<Document> = {}): Document {
  return {
    id,
    path,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...extra,
  };
}

interface GenerationState {
  baselineGeneration: number;
  baselinePathEpoch: Record<string, number>;
}
const store = () => useDocumentStore.getState();
const gen = () => store() as unknown as GenerationState;
const doc = (id: string) => store().getDocumentById(id)!;
const write = (id: string, content: string) => store().updateDocumentContent(id, content);
const ids = () => store().documents.map((d) => d.id);

beforeEach(() => {
  invokeMock.mockClear();
  held.clear();
  resetFileChanges();
  useDocumentStore.setState({ documents: [], activeDocumentId: null, baselineEpoch: {} });
  useDocumentStore.setState({ baselineGeneration: 0, baselinePathEpoch: {} } as never);
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("(a) the audit trace: rename P→Q, modify Q, close, then the P reply", () => {
  it("the P reply goes in dirty with no baseline", () => {
    store().upsertDocument(D("uuid", P, "A"));
    store().setActiveDocumentId("uuid");
    const startGeneration = gen().baselineGeneration; // the open of P, captured before its IPC
    recordFileChange({ path: P, changeType: "renamed", newPath: Q, timestamp: 1 }, "act-1");
    recordFileChange({ path: Q, changeType: "modified", timestamp: 2 }, "act-2");
    expect(doc("uuid").path).toBe(Q); // the tab followed the rename
    store().closeDocument("uuid");

    commitOpenedDocument(D(HASH_P, P, "DISK"), "file-open", { actionId: "act-open", startGeneration });

    expect([doc(HASH_P).isModified, doc(HASH_P).savedContent]).toEqual([true, undefined]);
    write(HASH_P, "DISK+1");
    write(HASH_P, "DISK");
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
  });
});

describe("(b) the mirror: a held open of Q while a tab moves onto Q", () => {
  it("the Q reply, matched by path to the moved tab, goes in dirty with no baseline", () => {
    store().upsertDocument(D("uuid", P, "A"));
    store().setActiveDocumentId("uuid");
    const startGeneration = gen().baselineGeneration; // the open of Q
    store().updateDocumentPath("uuid", Q); // rename-follow onto Q

    const result = commitOpenedDocument(D(HASH_Q, Q, "QDISK"), "file-open", { startGeneration });

    expect(result.document.id).toBe("uuid"); // D145: written in place under the tab's id
    expect([doc("uuid").isModified, doc("uuid").savedContent]).toEqual([true, undefined]);
  });
});

describe("(c) accepted cost: a Save As moving a tab while an open of the old path is held", () => {
  it("demotes the open of the old path", async () => {
    store().upsertDocument(D("uuid", P, "OLD"));
    store().setActiveDocumentId("uuid");
    write("uuid", "MID");
    const startGeneration = gen().baselineGeneration; // the open of P
    const saving = saveActiveDocumentAs("act-save-as");
    await vi.waitFor(() => expect(held.has("save_file_dialog")).toBe(true));
    held.get("save_file_dialog")!({ success: true, path: Q, savedAt: 1, changedSinceRead: false });
    await saving;
    expect(doc("uuid").path).toBe(Q);

    commitOpenedDocument(D(HASH_P, P, "DISK"), "file-open", { startGeneration });

    expect([doc(HASH_P).isModified, doc(HASH_P).savedContent]).toEqual([true, undefined]);
  });
});

describe("(d) every path-changing mutator stamps the old and the new path (store)", () => {
  it("updateDocumentPath", () => {
    store().upsertDocument(D("uuid", P, "A"));
    store().updateDocumentPath("uuid", Q);
    const g = gen().baselineGeneration;
    expect(g).toBeGreaterThan(0);
    expect(gen().baselinePathEpoch).toEqual({ [P]: g, [Q]: g });
  });

  it("updateDocumentPaths, one generation for the whole move", () => {
    store().upsertDocument(D("one", P, "A"));
    store().upsertDocument(D("two", "/tmp/r.md", "B"));
    store().updateDocumentPaths([
      { id: "one", path: Q },
      { id: "two", path: "/tmp/s.md" },
    ]);
    const g = gen().baselineGeneration;
    expect(g).toBe(1);
    expect(gen().baselinePathEpoch).toEqual({ [P]: g, [Q]: g, "/tmp/r.md": g, "/tmp/s.md": g });
  });

  it("a path-changing upsert (same id, new path)", () => {
    store().upsertDocument(D("uuid", P, "A"));
    store().upsertDocument(D("uuid", Q, "A"));
    const g = gen().baselineGeneration;
    expect(g).toBe(1);
    expect(gen().baselinePathEpoch).toEqual({ [P]: g, [Q]: g });
  });

  it("an untitled document given its first path stamps only the new path", () => {
    store().upsertDocument(D("uuid", null, "A"));
    store().updateDocumentPath("uuid", Q);
    expect(gen().baselinePathEpoch).toEqual({ [Q]: gen().baselineGeneration });
  });
});

describe("(e) a same-path write stamps nothing", () => {
  it("an ordinary save (same id, same path), a same-path move and a new tab leave the generation alone", () => {
    store().upsertDocument(D("a", P, "A"));
    write("a", "AB");
    store().upsertDocument(D("a", P, "AB")); // the applied save's clean upsert
    store().updateDocumentPath("a", P);
    store().updateDocumentPaths([{ id: "a", path: P }]);
    store().upsertDocument(D("b", Q, "B"));
    expect(gen().baselineGeneration).toBe(0);
    expect(gen().baselinePathEpoch).toEqual({});
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([false, "AB"]);
  });
});

describe("no store mutator swaps an id (inventory: none found in src/)", () => {
  it("path and content mutators keep every id; only closeDocument removes one, and it stamps it", () => {
    store().upsertDocument(D("uuid", P, "A"));
    store().upsertDocument(D(HASH_P, P, "A")); // a second id at the same path is a second tab
    expect(ids()).toEqual(["uuid", HASH_P]);
    store().updateDocumentPath("uuid", Q);
    store().updateDocumentPaths([{ id: HASH_P, path: "/tmp/r.md" }]);
    store().upsertDocument(D("uuid", P, "B"));
    store().updateDocumentContent("uuid", "C");
    store().markDocumentModified("uuid", false);
    store().dropBaseline("uuid");
    expect(ids()).toEqual(["uuid", HASH_P]);
    const before = gen().baselineGeneration;
    store().closeDocument(HASH_P);
    expect(ids()).toEqual(["uuid"]);
    expect(store().getBaselineEpoch(HASH_P)).toBeGreaterThan(before);
  });
});
