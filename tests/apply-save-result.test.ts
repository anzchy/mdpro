/**
 * D19-WI-3 — the store-applying half of a finished save (`applySaveResult` in
 * `src/services/saveService.ts`).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-232521-d19.md` §4 (W3-applied …
 * W3-log-privacy), laws A1–A5, CLOSED-CHECKS, F7 and F8. Real `documentStore` and
 * `milkdownEditorStore`; `invoke` (only `delete_draft` matters) and `loggingService` are
 * process boundaries; the settle-flush writer is a flusher double at the registry seam,
 * the same precedent as `tests/flush-call-sites.test.ts`. Paired real paths:
 * R-wysiwyg-pending (WI-1), rust `test_delete_draft_removes_file_and_returns_true`, and
 * WI-6 G-wys / G-log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { applySaveResult } from "../src/services/saveService";
import { loggingService } from "../src/services/loggingService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore, type Flusher } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { A_PATH, SAVED_AT, createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";

const logMock = vi.mocked(loggingService.logEventSync);
let held: HeldInvoke;

function makeDoc(id: string, content: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...overrides,
  };
}

const ok = (path: string = A_PATH) => ({ success: true, path, savedAt: SAVED_AT });
const docA = () => useDocumentStore.getState().getDocumentById("doc-a");
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const logs = () => logMock.mock.calls.map((c) => c[0]);
const logsOf = (event: string) => logs().filter((p) => p.event === event);
const draftsFor = (id: string) => held.calls("delete_draft").filter((a) => a.documentId === id);

function freshWorld(documents: Document[], activeDocumentId: string | null) {
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  logMock.mockClear();
  useDocumentStore.setState({ documents, activeDocumentId });
  useMilkdownEditorStore.setState({ flushers: {} });
}

function registerFlusher(id: string, fn: Flusher) {
  const flusher = vi.fn(fn);
  useMilkdownEditorStore.getState().registerFlusher(id, flusher);
  return flusher;
}

/** CLOSED-CHECKS: capture before the call, `check` after settling. */
function captureClosed() {
  const ref = useDocumentStore.getState().documents;
  let writes = 0;
  const unsubscribe = useDocumentStore.subscribe(() => {
    writes += 1;
  });
  return {
    check(actionId = "act-1") {
      unsubscribe();
      const { documents } = useDocumentStore.getState();
      expect(documents, "closed branch must not set documents").toBe(ref);
      expect(writes, "closed branch must not write the store").toBe(0);
      expect(documents.every((d) => typeof d.id === "string")).toBe(true);
      expect(logsOf("tab.open")).toHaveLength(0);
      const saves = logsOf("file.save");
      expect(saves).toHaveLength(1);
      expect(saves[0].context).toEqual({ documentId: "doc-a", closedDuringSave: true });
      expect(saves[0].actionId).toBe(actionId);
      expect(draftsFor("doc-a")).toHaveLength(0);
    },
  };
}

beforeEach(() => {
  freshWorld(
    [
      makeDoc("doc-a", "BASE", { path: A_PATH, isModified: true }),
      makeDoc("doc-b", "OTHER"),
    ],
    "doc-a",
  );
});

afterEach(() => {
  held.assertDrained();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("W3-applied — nothing changed during the await", () => {
  it("returns undefined, marks clean with the written content and deletes the draft", async () => {
    const ret = applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1");
    expect(ret).toBeUndefined();
    expect(docA()).toMatchObject({ content: "BASE", isModified: false, lastSaved: SAVED_AT });
    await settle();
    expect(held.calls("delete_draft")).toEqual([{ documentId: "doc-a" }]);
  });
});

describe("W3-applied-late-writer — the applier is synchronous and final (F8, A5)", () => {
  it("does not overwrite an edit that lands while delete_draft is resolving", async () => {
    held.reply(
      "delete_draft",
      () =>
        new Promise((r) =>
          setTimeout(() => {
            useDocumentStore.getState().updateDocumentContent("doc-a", "LATE");
            r(true);
          }, 0),
        ),
    );
    const ret: unknown = applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1");
    expect(ret).toBeUndefined();
    expect(typeof (ret as { then?: unknown } | undefined)?.then).not.toBe("function");
    await settle();
    await settle();
    expect(docA()).toMatchObject({ content: "LATE", isModified: true });
    expect(held.calls("delete_draft")).toHaveLength(1);
  });
});

describe("W3-edited — content changed during the await", () => {
  it("keeps the newer content dirty, records path/lastSaved, keeps the draft, logs once", async () => {
    useDocumentStore.getState().updateDocumentContent("doc-a", "BASE+NEW");
    applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1");
    expect(docA()).toMatchObject({
      content: "BASE+NEW",
      isModified: true,
      path: A_PATH,
      lastSaved: SAVED_AT,
    });
    await settle();
    expect(held.calls("delete_draft")).toHaveLength(0);
    const saves = logsOf("file.save");
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ status: "success", actionId: "act-1" });
    expect(saves[0].context).toEqual({ documentId: "doc-a", editedDuringSave: true });
    expect(JSON.stringify(saves[0].context)).not.toContain("BASE");
  });
});

describe("W3-closed — the tab was closed during the await", () => {
  it("writes nothing to the store, deletes no draft, logs closedDuringSave", async () => {
    freshWorld([makeDoc("doc-b", "OTHER")], "doc-b");
    const closed = captureClosed();
    const ret = applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1");
    expect(ret).toBeUndefined();
    await settle();
    closed.check("act-1");
  });
});

describe("W3-pending-wysiwyg — the settle flush runs before the compare", () => {
  it("takes the edited branch when the flush writes a pending edit", async () => {
    const flusher = registerFlusher("doc-a", () => {
      useDocumentStore.getState().updateDocumentContent("doc-a", "NEWER");
      return { status: "written" };
    });
    applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1");
    expect(flusher).toHaveBeenCalledWith("save-settle");
    expect(docA()).toMatchObject({ content: "NEWER", isModified: true });
    await settle();
    expect(held.calls("delete_draft")).toHaveLength(0);
  });
});

describe("W3-settle-failed — a failed settle flush keeps dirty; closed wins (F7)", () => {
  const failing: Record<string, Flusher> = {
    "returns-failed": () => ({ status: "failed" }),
    throws: () => {
      throw new Error("serializer exploded");
    },
  };

  it.each(["returns-failed", "throws"])("present doc, flusher %s → edited branch", async (mode) => {
    registerFlusher("doc-a", failing[mode]);
    expect(() => applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1")).not.toThrow();
    expect(docA()).toMatchObject({ content: "BASE", isModified: true, lastSaved: SAVED_AT });
    await settle();
    expect(held.calls("delete_draft")).toHaveLength(0);
  });

  it.each(["returns-failed", "throws"])("closed doc, flusher %s → CLOSED-CHECKS", async (mode) => {
    freshWorld([makeDoc("doc-b", "OTHER")], "doc-b");
    registerFlusher("doc-a", failing[mode]);
    const closed = captureClosed();
    expect(() => applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1")).not.toThrow();
    await settle();
    closed.check("act-1");
  });
});

describe("W3-settle-wrote-other-doc — a `written` flush for another doc is not an edit", () => {
  it("applies doc-a and leaves doc-b's flushed edit dirty", async () => {
    registerFlusher("doc-b", () => {
      useDocumentStore.getState().updateDocumentContent("doc-b", "OTHER+W");
      return { status: "written" };
    });
    applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1");
    expect(docA()).toMatchObject({ content: "BASE", isModified: false });
    expect(useDocumentStore.getState().getDocumentById("doc-b")).toMatchObject({
      content: "OTHER+W",
      isModified: true,
    });
    await settle();
    expect(held.calls("delete_draft")).toEqual([{ documentId: "doc-a" }]);
  });
});

describe("W3-draft-reject — a failed delete_draft is logged, not thrown", () => {
  it("keeps the doc clean and logs a draft.delete warn", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    held.reply("delete_draft", () => Promise.reject(new Error("EACCES")));
    applySaveResult("doc-a", "BASE", "BASE", ok(), "act-1");
    await settle();
    await settle();
    process.off("unhandledRejection", unhandled);
    expect(docA()).toMatchObject({ isModified: false });
    expect(unhandled).not.toHaveBeenCalled();
    const warns = logsOf("draft.delete");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ level: "warn", status: "fail" });
    expect(warns[0].context).toMatchObject({ documentId: "doc-a", error: "EACCES" });
  });
});

// ---- W3-frame (S5) and W3-log-privacy (S4): one row per branch driver ----

interface Texts {
  snap: string;
  writ: string;
  curr: string;
  path: string;
}
interface Row {
  name: string;
  applied: boolean;
  closed: boolean;
  aContent?: (t: Texts) => string;
  written: (t: Texts) => string;
  failFlush?: boolean;
}

const ROWS: Row[] = [
  { name: "applied", applied: true, closed: false, aContent: (t) => t.snap, written: (t) => t.snap },
  { name: "applied-with-reformat", applied: true, closed: false, aContent: (t) => t.snap, written: (t) => t.writ },
  { name: "edited", applied: false, closed: false, aContent: (t) => t.curr, written: (t) => t.snap },
  { name: "closed", applied: false, closed: true, written: (t) => t.snap },
  { name: "settle-failed", applied: false, closed: false, aContent: (t) => t.snap, written: (t) => t.snap, failFlush: true },
  { name: "settle-failed+closed", applied: false, closed: true, written: (t) => t.snap, failFlush: true },
];

/** Runs one row in a three-document store (doc-b active) and checks A1–A3, A5. */
async function runFrameRow(row: Row, t: Texts): Promise<number> {
  const docB = makeDoc("doc-b", "OTHER");
  const docC = makeDoc("doc-c", "THIRD", { isModified: true });
  const docs = row.aContent
    ? [makeDoc("doc-a", row.aContent(t), { path: t.path, isModified: true }), docB, docC]
    : [docB, docC];
  freshWorld(docs, "doc-b");
  if (row.failFlush) registerFlusher("doc-a", () => ({ status: "failed" }));
  const closed = row.closed ? captureClosed() : null;

  const ret = applySaveResult("doc-a", t.snap, row.written(t), ok(t.path), "act-1");
  await settle();

  expect(ret, row.name).toBeUndefined();
  const state = useDocumentStore.getState();
  expect(state.getDocumentById("doc-b"), row.name).toBe(docB);
  expect(state.getDocumentById("doc-c"), row.name).toBe(docC);
  expect(state.activeDocumentId, row.name).toBe("doc-b");
  const drafts = draftsFor("doc-a").length;
  expect(drafts, `${row.name}: delete_draft ⇔ applied`).toBe(row.applied ? 1 : 0);
  closed?.check("act-1");
  return drafts;
}

describe("W3-frame — no branch touches another document or the active id (A1–A3, A5)", () => {
  it("holds over every branch driver, and both sides of A2 are hit", async () => {
    const texts = { snap: "BASE", writ: "BASE-FMT", curr: "BASE+NEW", path: A_PATH };
    const seen = { withDraft: 0, withoutDraft: 0 };
    for (const row of ROWS) {
      const drafts = await runFrameRow(row, texts);
      if (drafts > 0) seen.withDraft += 1;
      else seen.withoutDraft += 1;
    }
    expect(seen.withDraft).toBeGreaterThan(0);
    expect(seen.withoutDraft).toBeGreaterThan(0);
  });
});

describe("W3-log-privacy — logs carry ids, kinds and the caller's actionId only (A4)", () => {
  const SENTINELS: Texts = {
    snap: "SNAP-§",
    writ: "WRIT-§",
    curr: "CURR-§",
    path: "/secret/p.md",
  };

  it.each(ROWS.map((r) => [r.name, r] as const))("%s", async (_name, row) => {
    await runFrameRow(row, SENTINELS);
    const serialized = JSON.stringify(logMock.mock.calls);
    for (const sentinel of Object.values(SENTINELS)) {
      expect(serialized, `log leaked ${sentinel}`).not.toContain(sentinel);
    }
    const allowed = ["documentId", "editedDuringSave", "closedDuringSave"];
    for (const entry of logsOf("file.save")) {
      for (const key of Object.keys(entry.context ?? {})) expect(allowed).toContain(key);
      expect(entry.actionId).toBe("act-1");
    }
  });
});
