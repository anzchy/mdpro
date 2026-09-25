/**
 * ADR-0035 WI-7 / A3 — the frontend backstop writer (WB-1..WB-8).
 *
 * `writeQuitBackstopDrafts()` flushes pending WYSIWYG edits, then drafts every
 * modified document in this window — active or background — through `save_draft`,
 * concurrently, and resolves only after every write has settled. Documents that
 * were discarded for this request and are unchanged since are skipped.
 *
 * Law (conservation and coverage):
 *  - draftedCount + failedCount === writes attempted + (flushFailed ? 1 : 0);
 *  - attempted set === {modified docs} − {snapshotted docs with unchanged content},
 *    independent of the active tab;
 *  - the promise settles after every `save_draft` has settled.
 *  - (ADR-0035 review M-1, WB-9/WB-10) undiscardedIds === the drafted docs that
 *    this request's snapshot holds with different content, whose `save_draft`
 *    resolved; a failed redraft is never listed, so its discard still deletes.
 *
 * Real: documentStore, milkdownEditorStore (flushers via the real `registerFlusher`).
 * Mocked only at boundaries: `@tauri-apps/api/core` `invoke` and loggingService.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn<InvokeFn>() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { takeDiscardSnapshot } from "../src/utils/quitDiscardSnapshot";
import {
  writeQuitBackstopDrafts,
  writeQuitBackstopDraftsWithIds,
} from "../src/utils/quitDraftBackstop";

function doc(id: string, content: string, isModified: boolean): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified,
    lastSaved: null,
    fileSize: null,
  };
}

function seedStore(documents: Document[], activeDocumentId: string | null): void {
  useDocumentStore.setState({ documents, activeDocumentId });
}

const draftCalls = () =>
  invokeMock.mock.calls.filter(([cmd]) => cmd === "save_draft").map(([, args]) => args ?? {});

const byId = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(a.documentId).localeCompare(String(b.documentId));

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  seedStore([], null);
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("WI-7 writeQuitBackstopDrafts", () => {
  it("WB-1 an active and a background dirty doc are both drafted with current content", async () => {
    seedStore([doc("a", "# A\nx", true), doc("b", "# B\ny", true), doc("c", "# C\nz", false)], "a");

    await expect(writeQuitBackstopDrafts()).resolves.toStrictEqual({
      draftedCount: 2,
      failedCount: 0,
      flushFailed: false,
    });
    expect(draftCalls().sort(byId)).toStrictEqual([
      { documentId: "a", content: "# A\nx", originalPath: "/tmp/a.md", title: "A" },
      { documentId: "b", content: "# B\ny", originalPath: "/tmp/b.md", title: "B" },
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("WB-2 one rejected write does not stop the others", async () => {
    seedStore([doc("a", "A", true), doc("b", "B", true), doc("c", "C", true)], "a");
    invokeMock.mockImplementation(async (_cmd, args) => {
      if (args?.documentId === "b") throw new Error("disk full");
      return null;
    });

    await expect(writeQuitBackstopDrafts()).resolves.toStrictEqual({
      draftedCount: 2,
      failedCount: 1,
      flushFailed: false,
    });
    expect(draftCalls().map((c) => c.documentId).sort()).toStrictEqual(["a", "b", "c"]);
  });

  it("WB-3a a window of clean docs makes no IPC", async () => {
    seedStore([doc("a", "A", false), doc("b", "B", false)], "a");

    await expect(writeQuitBackstopDrafts()).resolves.toStrictEqual({
      draftedCount: 0,
      failedCount: 0,
      flushFailed: false,
    });
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });

  it("WB-3b a window with zero docs makes no IPC", async () => {
    await expect(writeQuitBackstopDrafts()).resolves.toStrictEqual({
      draftedCount: 0,
      failedCount: 0,
      flushFailed: false,
    });
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });

  it("WB-4 a pending WYSIWYG edit is flushed before the read", async () => {
    seedStore([doc("a", "old", false)], "a");
    const reasons: string[] = [];
    useMilkdownEditorStore.getState().registerFlusher("a", (reason) => {
      reasons.push(reason);
      useDocumentStore.getState().updateDocumentContent("a", "flushed");
      useDocumentStore.getState().markDocumentModified("a", true);
      return { status: "written" };
    });

    await expect(writeQuitBackstopDrafts()).resolves.toStrictEqual({
      draftedCount: 1,
      failedCount: 0,
      flushFailed: false,
    });
    expect(draftCalls().map((c) => c.content)).toStrictEqual(["flushed"]);
    expect(reasons).toStrictEqual(["app-quit"]);
  });

  it("WB-5 a failed flush counts one failure", async () => {
    seedStore([doc("a", "A", true)], "a");
    useMilkdownEditorStore.getState().registerFlusher("a", () => ({ status: "failed" }));

    await expect(writeQuitBackstopDrafts()).resolves.toStrictEqual({
      draftedCount: 1,
      failedCount: 1,
      flushFailed: true,
    });
  });

  it("WB-6 the promise stays pending until every write settles", async () => {
    seedStore([doc("a", "A", true), doc("b", "B", true)], "b");
    const held: Array<() => void> = [];
    invokeMock.mockImplementation(
      () => new Promise<unknown>((resolve) => held.push(() => resolve(null))),
    );
    let settled = false;
    const result = writeQuitBackstopDrafts().then((r) => {
      settled = true;
      return r;
    });

    await flushMicrotasks();
    expect(held.length).toBe(2);
    expect(settled).toBe(false);

    held[0]();
    await flushMicrotasks();
    expect(settled).toBe(false);

    held[1]();
    await flushMicrotasks();
    expect(settled).toBe(true);
    await expect(result).resolves.toStrictEqual({
      draftedCount: 2,
      failedCount: 0,
      flushFailed: false,
    });
  });

  it("WB-7 snapshotted unchanged docs are skipped, and changed ones are written", async () => {
    seedStore([doc("a", "A1", true), doc("b", "B1", true)], "a");
    const snapshot = takeDiscardSnapshot(
      4,
      [
        { id: "a", content: "A1" },
        { id: "b", content: "B0" },
      ],
      ["a", "b"],
    );

    await expect(writeQuitBackstopDrafts({ snapshot, requestId: 4 })).resolves.toStrictEqual({
      draftedCount: 1,
      failedCount: 0,
      flushFailed: false,
    });
    expect(draftCalls().map((c) => c.documentId)).toStrictEqual(["b"]);
  });

  it("WB-7b a snapshot from another request skips nothing", async () => {
    seedStore([doc("a", "A1", true)], "a");
    const snapshot = takeDiscardSnapshot(4, [{ id: "a", content: "A1" }], ["a"]);

    await expect(writeQuitBackstopDrafts({ snapshot, requestId: 5 })).resolves.toStrictEqual({
      draftedCount: 1,
      failedCount: 0,
      flushFailed: false,
    });
    expect(draftCalls().map((c) => c.documentId)).toStrictEqual(["a"]);
  });

  it("WB-8 property: conservation and coverage over generated stores", async () => {
    const seed = 0xad35_0708n;
    let s = seed;
    const below = (n: number): number => {
      s = (s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let z = ((s ^ (s >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return Number((z ^ (z >> 31n)) % BigInt(n));
    };
    const contents = ["", "x", "# T\ny", "# U\n", "z z"];
    const pick = () => contents[below(contents.length)];

    for (let i = 0; i < 300; i++) {
      const label = `seed ${seed} index ${i}`;
      const docs = Array.from({ length: below(11) }, (_, k) =>
        doc(`d${k}`, pick(), below(2) === 1),
      );
      const active = docs.length > 0 && below(4) > 0 ? docs[below(docs.length)].id : null;
      const rejected = new Set(docs.filter(() => below(3) === 0).map((d) => d.id));
      const snapContent: Record<string, string> = {};
      const useSnapshot = below(2) === 1;
      if (useSnapshot) {
        for (const d of docs) {
          if (below(2) === 1) snapContent[d.id] = below(2) === 1 ? d.content : pick();
        }
      }
      const flushFailed = below(10) === 0;

      invokeMock.mockReset();
      invokeMock.mockImplementation(async (_cmd, args) => {
        if (rejected.has(String(args?.documentId))) throw new Error("rejected");
        return null;
      });
      seedStore(docs, active);
      useMilkdownEditorStore.setState({ flushers: {} });
      if (flushFailed) {
        useMilkdownEditorStore.getState().registerFlusher("zz", () => ({ status: "failed" }));
      }
      const snapshot = useSnapshot
        ? takeDiscardSnapshot(
            3,
            Object.entries(snapContent).map(([id, content]) => ({ id, content })),
            Object.keys(snapContent),
          )
        : null;

      const got = await writeQuitBackstopDrafts({ snapshot, requestId: 3 });

      const inSnap = (id: string) => Object.prototype.hasOwnProperty.call(snapContent, id);
      const want = docs
        .filter((d) => d.isModified && !(inSnap(d.id) && snapContent[d.id] === d.content))
        .map((d) => d.id)
        .sort();
      const wantRejected = want.filter((id) => rejected.has(id)).length;
      expect(draftCalls().map((c) => String(c.documentId)).sort(), label).toStrictEqual(want);
      for (const c of draftCalls()) {
        const d = docs.find((x) => x.id === c.documentId);
        expect([c.content, c.originalPath], label).toStrictEqual([d?.content, d?.path]);
      }
      expect(got, label).toStrictEqual({
        draftedCount: want.length - wantRejected,
        failedCount: wantRejected + (flushFailed ? 1 : 0),
        flushFailed,
      });
    }
  });
});

describe("ADR-0035 review M-1 writeQuitBackstopDraftsWithIds", () => {
  it("WB-9 lists exactly the discarded-then-edited docs whose redraft resolved", async () => {
    seedStore(
      [
        doc("a", "A1", true), // discarded as A0, edited: redrafted and listed
        doc("b", "B0", true), // discarded, unchanged: skipped
        doc("c", "C1", true), // discarded as C0, edited, but the write fails
        doc("d", "D", true), // never discarded: drafted, not listed
      ],
      "a",
    );
    const snapshot = takeDiscardSnapshot(
      4,
      [
        { id: "a", content: "A0" },
        { id: "b", content: "B0" },
        { id: "c", content: "C0" },
      ],
      ["a", "b", "c"],
    );
    invokeMock.mockImplementation(async (_cmd, args) => {
      if (args?.documentId === "c") throw new Error("disk full");
      return null;
    });

    await expect(
      writeQuitBackstopDraftsWithIds({ snapshot, requestId: 4 }),
    ).resolves.toStrictEqual({
      counts: { draftedCount: 2, failedCount: 1, flushFailed: false },
      undiscardedIds: ["a"],
    });
    expect(draftCalls().map((c) => c.documentId).sort()).toStrictEqual(["a", "c", "d"]);
  });

  it("WB-9b a snapshot from another request, or none, lists nothing", async () => {
    seedStore([doc("a", "A1", true)], "a");
    const snapshot = takeDiscardSnapshot(4, [{ id: "a", content: "A0" }], ["a"]);

    for (const options of [{ snapshot, requestId: 5 }, { snapshot: null, requestId: 4 }, {}]) {
      await expect(writeQuitBackstopDraftsWithIds(options)).resolves.toStrictEqual({
        counts: { draftedCount: 1, failedCount: 0, flushFailed: false },
        undiscardedIds: [],
      });
    }
  });

  it("WB-10 property: the listed ids and the counts over generated stores", async () => {
    const seed = 0xad35_0710n;
    let s = seed;
    const below = (n: number): number => {
      s = (s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let z = ((s ^ (s >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return Number((z ^ (z >> 31n)) % BigInt(n));
    };
    const contents = ["", "x", "# T\ny", "z z"];
    const pick = () => contents[below(contents.length)];
    let listedSeen = 0;

    for (let i = 0; i < 300; i++) {
      const label = `seed ${seed} index ${i}`;
      const docs = Array.from({ length: below(9) }, (_, k) => doc(`d${k}`, pick(), below(3) > 0));
      const rejected = new Set(docs.filter(() => below(4) === 0).map((d) => d.id));
      const snapContent: Record<string, string> = {};
      for (const d of docs) if (below(2) === 1) snapContent[d.id] = below(2) === 1 ? d.content : pick();
      const snapRequest = below(4) === 0 ? 8 : 3;

      invokeMock.mockReset();
      invokeMock.mockImplementation(async (_cmd, args) => {
        if (rejected.has(String(args?.documentId))) throw new Error("rejected");
        return null;
      });
      seedStore(docs, docs[0]?.id ?? null);
      const snapshot = takeDiscardSnapshot(
        snapRequest,
        Object.entries(snapContent).map(([id, content]) => ({ id, content })),
        Object.keys(snapContent),
      );

      const got = await writeQuitBackstopDraftsWithIds({ snapshot, requestId: 3 });

      const inSnap = (id: string) =>
        snapRequest === 3 && Object.prototype.hasOwnProperty.call(snapContent, id);
      const attempted = docs.filter(
        (d) => d.isModified && !(inSnap(d.id) && snapContent[d.id] === d.content),
      );
      const want = attempted
        .filter((d) => inSnap(d.id) && !rejected.has(d.id))
        .map((d) => d.id)
        .sort();
      listedSeen += want.length;
      expect([...got.undiscardedIds].sort(), label).toStrictEqual(want);
      const failed = attempted.filter((d) => rejected.has(d.id)).length;
      expect(got.counts, label).toStrictEqual({
        draftedCount: attempted.length - failed,
        failedCount: failed,
        flushFailed: false,
      });
    }
    expect(listedSeen).toBeGreaterThan(20);
  });
});
