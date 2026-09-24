/**
 * D20 / ADR-0028 WI-1 — the shared open-write guard (`src/utils/openWriteGuard.ts`).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260924-105300.md`, Units A (commitOpenedDocument),
 * B (focusDirtyOpenAt) and the L-1 log sweep for this file. Unit C belongs to WI-3.
 *
 * Law under test: a dirty candidate is never written by an open action. The candidates
 * are the document whose id equals `decoded.id` plus every document whose path equals
 * `decoded.path`. The guard flushes with reason "reopen" first, then reads the store.
 *
 * Mock boundary (matrix §0): only `@tauri-apps/api/{core,event}` and the
 * `loggingService` recording sink are replaced. Every store is real. The flusher double
 * is registered through the public `registerFlusher` seam (precedent:
 * `tests/flush-call-sites.test.ts`), and every registration is removed in `afterEach`.
 *
 * Flusher doubles that write are one-shot, like the real edit-sync controller: the
 * first flush writes the pending edit, and any later flush finds nothing pending.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

const { sink } = vi.hoisted(() => {
  const s = {
    generateActionId: vi.fn(() => "test-id"),
    logEvent: vi.fn(async () => {}),
    logEventSync: vi.fn(),
    logUiEvent: vi.fn(() => "test-id"),
    logShortcut: vi.fn(),
    logMenuSelect: vi.fn(),
    logButtonClick: vi.fn(),
    logDialogAction: vi.fn(),
    getLoggingSettings: vi.fn(async () => ({ enabled: true, level: "info" })),
    hydrateSettings: vi.fn(async () => ({ enabled: true, level: "info" })),
    setLoggingSettings: vi.fn(async (x: unknown) => x),
  };
  return { sink: s };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import { commitOpenedDocument, focusDirtyOpenAt } from "../src/utils/openWriteGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import { asAnchorSlug } from "../src/types/toc";
import type { ParsedTOCEntry } from "../src/types/toc";
import type { Document } from "../src/types/document";

// --- fixtures ---------------------------------------------------------------

const SENTINELS = [
  "BUF-SENTINEL", "DISK-SENTINEL", "OTHER", "SAVED-AS-EDIT", "EDIT", "BASE", "DISK",
  "X-BODY", "Z-BODY", "X-EDIT", "Z-EDIT", "P1-BODY", "P2-BODY", "P1-EDIT", "P2-EDIT",
  "OLD-SENTINEL", "NEW-SENTINEL",
] as const;

const GENERATIONS: Record<string, number> = {
  "doc-t": 3, "doc-x": 3, "doc-z": 7, "doc-p1": 9, "doc-p2": 11, "doc-o": 5,
};

function doc(id: string, p: string | null, content: string, isModified: boolean): Document {
  return {
    id, path: p, content, encoding: "UTF-8", lineEnding: "lf",
    isModified, lastSaved: null, fileSize: null,
  };
}

/** A-17 / B-3: no `doc-t` key, so a write that created one would show. */
const GENERATIONS_NO_T: Record<string, number> = Object.fromEntries(
  Object.entries(GENERATIONS).filter(([id]) => id !== "doc-t"),
);

const docO = (dirty: boolean) => doc("doc-o", "/tmp/o.md", "OTHER", dirty);

function decodedT(over: Partial<Document> = {}): Document {
  return { ...doc("doc-t", "/tmp/t.md", "DISK-SENTINEL", false), fileSize: 10, ...over };
}

const HEADINGS: ParsedTOCEntry[] = [
  { anchorSlug: asAnchorSlug("guide"), level: 1, text: "Guide", lineNumber: 1, offset: 0 },
];

function seed(docs: Document[], tocTarget: string, generations = GENERATIONS): void {
  useDocumentStore.setState({ documents: docs, activeDocumentId: "doc-o" });
  useEditorStore.setState({ activeDocumentId: "doc-o" });
  useMilkdownEditorStore.setState({
    getEditor: () => null, flushers: {}, editorGenerations: { ...generations },
  });
  useTOCStore.setState({
    entries: [], documentId: null, activeEntryId: null,
    collapsedIds: new Set(), byDocument: new Map(),
  });
  useTOCStore.getState().setEntries(HEADINGS, "doc-o");
  useTOCStore.getState().setEntries(HEADINGS, tocTarget);
  const key = useTOCStore.getState().entries[0].key;
  useTOCStore.getState().toggleCollapsed(key);
}

function tocSnapshot() {
  const s = useTOCStore.getState();
  return {
    documentId: s.documentId,
    entries: JSON.parse(JSON.stringify(s.entries)) as unknown,
    collapsedIds: [...s.collapsedIds],
    byDocument: [...s.byDocument.keys()],
  };
}

function snapshot() {
  return {
    documents: structuredClone(useDocumentStore.getState().documents),
    generations: { ...useMilkdownEditorStore.getState().editorGenerations },
    toc: tocSnapshot(),
    activeDoc: useDocumentStore.getState().activeDocumentId,
    activeEditor: useEditorStore.getState().activeDocumentId,
  };
}

const docs = () => useDocumentStore.getState().documents;
const docById = (id: string) => docs().find((d) => d.id === id);
const activeIds = () => [
  useDocumentStore.getState().activeDocumentId,
  useEditorStore.getState().activeDocumentId,
];

function omit<T extends Record<string, unknown>>(obj: T, key: string): Record<string, unknown> {
  const { [key]: _drop, ...rest } = obj;
  void _drop;
  return rest;
}

// --- flusher double at the registerFlusher seam -----------------------------

type FlushMode =
  | "clean"
  | "failed"
  | "throw"
  | { writeTo: string; content: string };

interface FlusherDouble {
  reasons: string[];
  /** documents right after the double's write; null when it never wrote. */
  sPost: Document[] | null;
}

let cleanups: Array<() => void> = [];

function installFlusher(documentId: string, mode: FlushMode): FlusherDouble {
  const double: FlusherDouble = { reasons: [], sPost: null };
  let pending = typeof mode === "object";
  const cleanup = useMilkdownEditorStore.getState().registerFlusher(documentId, (reason) => {
    double.reasons.push(reason);
    if (mode === "throw") throw new Error("serializer");
    if (mode === "failed") return { status: "failed" };
    if (typeof mode === "object" && pending) {
      pending = false;
      useDocumentStore.getState().updateDocumentContent(mode.writeTo, mode.content);
      double.sPost = structuredClone(useDocumentStore.getState().documents);
      return { status: "written" };
    }
    return { status: "clean" };
  });
  cleanups.push(cleanup);
  return double;
}

function removeFlushers(): void {
  for (const c of cleanups) c();
  cleanups = [];
}

// --- log sink helpers and the L-1 sweep -------------------------------------

interface LogCall {
  event: string;
  context?: Record<string, unknown>;
}

const logCalls = (): LogCall[] => sink.logEventSync.mock.calls.map((c) => c[0] as LogCall);
const eventsSince = (start: number, event: string) =>
  logCalls().slice(start).filter((c) => c.event === event);

const swept = { total: 0, focusDirty: 0, reloadClean: 0 };

function errorReplacer(_k: string, v: unknown) {
  return v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
}

beforeEach(() => {
  removeFlushers();
});

afterEach(() => {
  removeFlushers();
  const testName = expect.getState().currentTestName ?? "<unknown>";
  for (const fn of Object.values(sink)) {
    for (const args of fn.mock.calls) {
      swept.total += 1;
      const first = args[0] as LogCall | undefined;
      if (fn === sink.logEventSync && first?.event === "file.open.focus_dirty") swept.focusDirty += 1;
      if (fn === sink.logEventSync && first?.event === "file.open.reload_clean") swept.reloadClean += 1;
      const serialized = JSON.stringify(args, errorReplacer);
      for (const s of SENTINELS) {
        expect(serialized.includes(s), `L-1 [${testName}] log call carries sentinel ${s}`).toBe(false);
      }
    }
    fn.mockClear();
  }
});

afterAll(() => {
  expect(swept.total, "L-1 non-vacuity: calls swept").toBeGreaterThan(0);
  expect(swept.focusDirty, "L-1 non-vacuity: focus_dirty swept").toBeGreaterThan(0);
  expect(swept.reloadClean, "L-1 non-vacuity: reload_clean swept").toBeGreaterThan(0);
});

// --- law-table row runners (A-1, A-16), reused by the S6 union relation ------

interface LawRow {
  label: string;
  kind: string;
  matchedBy: string | undefined;
  focusedId: string | undefined;
  unchanged: boolean;
  lawSaysUnchanged: boolean;
  groupKey: string;
}

/** Store unchanged relative to S_post / pre, computed from observation only. */
function isUnchanged(sPost: Document[], pre: ReturnType<typeof snapshot>): boolean {
  const now = snapshot();
  return (
    JSON.stringify(now.documents) === JSON.stringify(sPost) &&
    JSON.stringify(now.generations) === JSON.stringify(pre.generations) &&
    JSON.stringify(now.toc) === JSON.stringify(pre.toc)
  );
}

/** The law's right-hand side, from the pre-state candidate set and S_post. */
function lawUnchanged(preDocs: Document[], sPost: Document[], decoded: Document, failed: boolean) {
  const candidateIds = preDocs
    .filter((d) => d.id === decoded.id || d.path === decoded.path)
    .map((d) => d.id);
  const dirtyAfter = candidateIds.some((id) => sPost.find((d) => d.id === id)?.isModified);
  return dirtyAfter || (failed && candidateIds.length > 0);
}

const MATCHES = ["id", "path", "both", "none"] as const;
const FLUSHES_1 = ["clean", "written", "failed"] as const;

function runA1Rows(): LawRow[] {
  const rows: LawRow[] = [];
  const decoded = decodedT();
  for (const match of MATCHES) {
    for (const targetDirty of [true, false]) {
      for (const flush of FLUSHES_1) {
        for (const otherDirty of [true, false]) {
          const label = `A-1 ${match}/${targetDirty ? "dirty" : "clean"}/${flush}/other-${otherDirty ? "dirty" : "clean"}`;
          removeFlushers();
          const target =
            match === "id" ? doc("doc-t", "/tmp/old.md", "BUF-SENTINEL", targetDirty)
            : match === "path" ? doc("doc-x", "/tmp/t.md", "BUF-SENTINEL", targetDirty)
            : match === "both" ? doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", targetDirty)
            : null;
          const preDocs = [docO(otherDirty), ...(target ? [target] : [])];
          seed(structuredClone(preDocs), target?.id ?? "doc-t");
          const pre = snapshot();
          const writeTo = target?.id ?? "doc-o";
          const fl = installFlusher(
            writeTo,
            flush === "written"
              ? { writeTo, content: (target?.content ?? "OTHER") + "+P" }
              : flush,
          );
          const logStart = logCalls().length;

          const result = commitOpenedDocument(decoded, "file-open");
          const sPost = fl.sPost ?? pre.documents;

          const exists = match !== "none";
          const dirtyAfter = exists && (targetDirty || flush === "written");
          const focus = exists && (dirtyAfter || flush === "failed");
          const focusDirtyLogs = eventsSince(logStart, "file.open.focus_dirty");

          if (focus) {
            const expectedMatchedBy = match === "path" ? "path" : "id";
            expect(result, label).toEqual({
              kind: "focused-dirty",
              matchedBy: expectedMatchedBy,
              document: sPost.find((d) => d.id === target!.id),
            });
            expect(docs(), label).toEqual(sPost);
            expect(docs().length, label).toBe(preDocs.length);
            if (match === "path") expect(docById("doc-t"), label).toBeUndefined();
            expect(useMilkdownEditorStore.getState().editorGenerations, label).toEqual(pre.generations);
            expect(tocSnapshot(), label).toEqual(pre.toc);
            expect(activeIds(), label).toEqual([target!.id, target!.id]);
            expect(focusDirtyLogs.length, label).toBe(1);
            expect(focusDirtyLogs[0].context, label).toEqual({
              documentId: target!.id,
              entry: "file-open",
              matchedBy: expectedMatchedBy,
              flushFailed: flush === "failed",
            });
          } else {
            expect(result, label).toEqual({ kind: "written", document: decoded, largeFile: false });
            expect(docs().filter((d) => d.id === "doc-t"), label).toEqual([decoded]);
            expect(docById("doc-o"), label).toEqual(sPost.find((d) => d.id === "doc-o"));
            const gens = useMilkdownEditorStore.getState().editorGenerations;
            expect(gens["doc-t"], label).toBe(pre.generations["doc-t"] + 1);
            expect(omit(gens, "doc-t"), label).toEqual(omit(pre.generations, "doc-t"));
            expect(useTOCStore.getState().documentId, label).not.toBe("doc-t");
            expect(useTOCStore.getState().byDocument.has("doc-t"), label).toBe(false);
            expect(activeIds(), label).toEqual(["doc-t", "doc-t"]);
            const grows = match === "path" || match === "none" ? 1 : 0;
            expect(docs().length, label).toBe(preDocs.length + grows);
            expect(focusDirtyLogs.length, label).toBe(0);
            if (exists) {
              expect(eventsSince(logStart, "file.open.reload_clean").length, label).toBe(1);
            }
          }

          rows.push({
            label,
            kind: result.kind,
            matchedBy: result.kind === "focused-dirty" ? result.matchedBy : undefined,
            focusedId: result.kind === "focused-dirty" ? result.document.id : undefined,
            unchanged: isUnchanged(sPost, pre),
            lawSaysUnchanged: lawUnchanged(preDocs, sPost, decoded, flush === "failed"),
            groupKey: `${match}|${targetDirty}|${flush}`,
          });
        }
      }
    }
  }
  return rows;
}

const FLUSHES_16 = ["clean", "written-X", "written-Z", "written-O", "failed"] as const;

function runA16Rows(): LawRow[] {
  const rows: LawRow[] = [];
  const decoded = decodedT();
  for (const idDirty of [true, false]) {
    for (const pathDirty of [true, false]) {
      for (const flush of FLUSHES_16) {
        for (const order of ["X-first", "Z-first"] as const) {
          for (const otherDirty of [true, false]) {
            const label = `A-16 id-${idDirty}/path-${pathDirty}/${flush}/${order}/other-${otherDirty}`;
            removeFlushers();
            const X = doc("doc-t", "/tmp/elsewhere.md", idDirty ? "X-EDIT" : "X-BODY", idDirty);
            const Z = doc("doc-z", "/tmp/t.md", pathDirty ? "Z-EDIT" : "Z-BODY", pathDirty);
            const preDocs = order === "X-first" ? [docO(otherDirty), X, Z] : [docO(otherDirty), Z, X];
            seed(structuredClone(preDocs), "doc-t");
            const pre = snapshot();
            const mode: FlushMode =
              flush === "written-X" ? { writeTo: "doc-t", content: X.content + "+P" }
              : flush === "written-Z" ? { writeTo: "doc-z", content: Z.content + "+P" }
              : flush === "written-O" ? { writeTo: "doc-o", content: "OTHER+P" }
              : flush;
            const fl = installFlusher(typeof mode === "object" ? mode.writeTo : "doc-o", mode);
            const logStart = logCalls().length;

            const result = commitOpenedDocument(decoded, "file-open");
            const sPost = fl.sPost ?? pre.documents;

            const xDirty = idDirty || flush === "written-X";
            const zDirty = pathDirty || flush === "written-Z";
            const focus = xDirty || zDirty || flush === "failed";
            const focusDirtyLogs = eventsSince(logStart, "file.open.focus_dirty");
            const reloadLogs = eventsSince(logStart, "file.open.reload_clean");

            if (focus) {
              const focused = xDirty ? "doc-t" : zDirty ? "doc-z" : "doc-t";
              const matchedBy = focused === "doc-t" ? "id" : "path";
              expect(result, label).toEqual({
                kind: "focused-dirty",
                matchedBy,
                document: sPost.find((d) => d.id === focused),
              });
              expect(docs(), label).toEqual(sPost);
              expect(docs().length, label).toBe(3);
              expect(useMilkdownEditorStore.getState().editorGenerations, label).toEqual(pre.generations);
              expect(tocSnapshot(), label).toEqual(pre.toc);
              expect(activeIds(), label).toEqual([focused, focused]);
              expect(focusDirtyLogs.length, label).toBe(1);
              expect(focusDirtyLogs[0].context, label).toEqual({
                documentId: focused,
                entry: "file-open",
                matchedBy,
                flushFailed: flush === "failed",
              });
            } else {
              expect(result, label).toEqual({ kind: "written", document: decoded, largeFile: false });
              expect(docById("doc-t"), label).toEqual(decoded);
              expect(docById("doc-z"), label).toEqual(sPost.find((d) => d.id === "doc-z"));
              expect(docById("doc-o"), label).toEqual(sPost.find((d) => d.id === "doc-o"));
              expect(docs().length, label).toBe(3);
              const gens = useMilkdownEditorStore.getState().editorGenerations;
              expect(gens["doc-t"], label).toBe(4);
              expect(gens["doc-z"], label).toBe(7);
              expect(gens["doc-o"], label).toBe(5);
              expect(activeIds(), label).toEqual(["doc-t", "doc-t"]);
              expect(focusDirtyLogs.length, label).toBe(0);
              expect(reloadLogs.length, label).toBe(1);
            }

            rows.push({
              label,
              kind: result.kind,
              matchedBy: result.kind === "focused-dirty" ? result.matchedBy : undefined,
              focusedId: result.kind === "focused-dirty" ? result.document.id : undefined,
              unchanged: isUnchanged(sPost, pre),
              lawSaysUnchanged: lawUnchanged(preDocs, sPost, decoded, flush === "failed"),
              groupKey: `${idDirty}|${pathDirty}|${flush}`,
            });
          }
        }
      }
    }
  }
  return rows;
}

/** S6: the answer within each group is identical across the varied dimensions. */
function expectGroupsUniform(rows: LawRow[]): void {
  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = groups.get(r.groupKey) ?? new Set<string>();
    set.add(`${r.kind}|${r.matchedBy}|${r.focusedId}`);
    groups.set(r.groupKey, set);
  }
  for (const [key, answers] of groups) {
    expect(answers.size, `S6 group ${key}: ${[...answers].join(", ")}`).toBe(1);
  }
}

// --- Unit A -------------------------------------------------------------------

describe("Unit A — commitOpenedDocument", () => {
  it("A-1 law table: match × target dirtiness × flush × other tab (48 rows)", () => {
    const rows = runA1Rows();
    expect(rows.length).toBe(48);
    expect(rows.filter((r) => r.kind === "focused-dirty").length).toBe(30);
    expect(rows.filter((r) => r.kind === "written").length).toBe(18);
    for (const m of MATCHES) {
      expect(rows.some((r) => r.groupKey.startsWith(`${m}|`)), `match ${m} hit`).toBe(true);
    }
    const focusRows = rows.filter((r) => r.kind === "focused-dirty");
    expect(focusRows.filter((r) => r.groupKey.endsWith("|failed")).length).toBe(12);
    expect(focusRows.filter((r) => r.matchedBy === "path").length).toBe(10);
    expectGroupsUniform(rows);
  });

  it("A-2 Save As shape: a path match with a different id is focused, no second tab", () => {
    const X = doc("doc-x", "/tmp/p2.md", "SAVED-AS-EDIT", true);
    seed([docO(false), structuredClone(X)], "doc-x");
    const pre = snapshot();
    installFlusher("doc-o", "clean");
    const decoded = { ...doc("doc-y", "/tmp/p2.md", "DISK", false) };

    const result = commitOpenedDocument(decoded, "file-open");

    expect(result).toEqual({ kind: "focused-dirty", matchedBy: "path", document: X });
    expect(docById("doc-y")).toBeUndefined();
    expect(docs().filter((d) => d.path === "/tmp/p2.md").length).toBe(1);
    expect(docById("doc-x")).toEqual(X);
    expect(activeIds()).toEqual(["doc-x", "doc-x"]);
    expect(useMilkdownEditorStore.getState().editorGenerations).toEqual(pre.generations);
  });

  it("A-3 id match whose path changed: focused, path left alone", () => {
    const X = doc("doc-t", "/tmp/renamed.md", "EDIT", true);
    seed([docO(false), structuredClone(X)], "doc-t");

    const result = commitOpenedDocument({ ...decodedT({ content: "DISK" }) }, "file-open");

    expect(result).toEqual({ kind: "focused-dirty", matchedBy: "id", document: X });
    expect(docById("doc-t")?.path).toBe("/tmp/renamed.md");
    expect(docById("doc-t")?.content).toBe("EDIT");
    expect(docs().filter((d) => d.id === "doc-t").length).toBe(1);
    expect(activeIds()).toEqual(["doc-t", "doc-t"]);
  });

  it("A-4 a pending edit is flushed with reason 'reopen' before the decision", () => {
    seed([docO(false), doc("doc-t", "/tmp/t.md", "BASE", false)], "doc-t");
    let pending: string | null = "Q";
    const reasons: string[] = [];
    const cleanup = useMilkdownEditorStore.getState().registerFlusher(
      "doc-t",
      (reason) => {
        reasons.push(reason);
        if (pending === null) return { status: "clean" };
        useDocumentStore.getState().updateDocumentContent("doc-t", "BASE" + pending);
        pending = null;
        return { status: "written" };
      },
      () => {
        const had = pending !== null;
        pending = null;
        return had;
      },
    );
    cleanups.push(cleanup);

    const result = commitOpenedDocument(decodedT(), "file-open");

    expect(result).toMatchObject({ kind: "focused-dirty", matchedBy: "id" });
    expect(docById("doc-t")?.content).toBe("BASEQ");
    expect(docById("doc-t")?.isModified).toBe(true);
    expect(useMilkdownEditorStore.getState().editorGenerations["doc-t"]).toBe(3);
    expect(reasons).toEqual(["reopen"]);
  });

  it("A-5 a failed (thrown) flush with no target still writes", () => {
    const { "doc-t": _absent, ...gens } = GENERATIONS;
    void _absent;
    seed([docO(true)], "doc-o", gens);
    installFlusher("doc-o", "throw");
    const decoded = decodedT();

    const result = commitOpenedDocument(decoded, "file-open");

    expect(result).toEqual({ kind: "written", document: decoded, largeFile: false });
    expect(docById("doc-t")).toEqual(decoded);
    expect(docById("doc-o")).toEqual(docO(true));
    expect(activeIds()).toEqual(["doc-t", "doc-t"]);
    expect(useMilkdownEditorStore.getState().editorGenerations["doc-t"]).toBe(1);
  });

  it("A-6 a failed flush with a clean target present means focus", () => {
    const T = doc("doc-t", "/tmp/t.md", "BASE", false);
    seed([docO(false), structuredClone(T)], "doc-t");
    const pre = snapshot();
    installFlusher("doc-t", "failed");

    const result = commitOpenedDocument(decodedT({ content: "DISK" }), "file-open");

    expect(result).toEqual({ kind: "focused-dirty", matchedBy: "id", document: T });
    const post = snapshot();
    expect(post.documents).toEqual(pre.documents);
    expect(post.generations).toEqual(pre.generations);
    expect(post.toc).toEqual(pre.toc);
    expect(activeIds()).toEqual(["doc-t", "doc-t"]);
  });

  it("A-7 a clean target reloads exactly as today", () => {
    seed([docO(false), { ...doc("doc-t", "/tmp/t.md", "OLD-SENTINEL", false), lastSaved: 1 }], "doc-t");
    const decoded = decodedT({ content: "NEW-SENTINEL", lastSaved: 2 });

    const result = commitOpenedDocument(decoded, "file-open");

    expect(result).toEqual({ kind: "written", document: decoded, largeFile: false });
    expect(docById("doc-t")).toEqual(decoded);
    expect(useMilkdownEditorStore.getState().editorGenerations["doc-t"]).toBe(4);
    expect(useTOCStore.getState().documentId).toBeNull();
    expect(useTOCStore.getState().entries).toEqual([]);
    expect(activeIds()).toEqual(["doc-t", "doc-t"]);
  });

  it("A-8 idempotence: focusing twice", () => {
    seed([docO(false), doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", true)], "doc-t");
    const r1 = commitOpenedDocument(decodedT(), "file-open");
    const after1 = snapshot();
    const r2 = commitOpenedDocument(decodedT(), "file-open");
    const after2 = snapshot();

    expect(r1.kind).toBe("focused-dirty");
    expect(r2).toEqual(r1);
    expect(after2).toEqual(after1);
  });

  it("A-9 idempotence: a clean reload twice converges on documents", () => {
    seed([docO(false), doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", false)], "doc-t");
    const decoded = decodedT();
    const r1 = commitOpenedDocument(decoded, "file-open");
    const docs1 = structuredClone(docs());
    const gen1 = useMilkdownEditorStore.getState().editorGenerations["doc-t"];
    const r2 = commitOpenedDocument(decoded, "file-open");
    const gen2 = useMilkdownEditorStore.getState().editorGenerations["doc-t"];

    expect(r1.kind).toBe("written");
    expect(r2.kind).toBe("written");
    expect(docs()).toEqual(docs1);
    expect(docs().filter((d) => d.id === "doc-t").length).toBe(1);
    expect(gen1).toBe(4);
    expect(gen2).toBe(5);
  });

  it("A-10 the synchronous contract", () => {
    seed([docO(false), doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", false)], "doc-t");
    const clean = commitOpenedDocument(decodedT(), "file-open");
    seed([docO(false), doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", true)], "doc-t");
    const dirty = commitOpenedDocument(decodedT(), "file-open");

    expect(typeof (clean as { then?: unknown }).then).toBe("undefined");
    expect(typeof (dirty as { then?: unknown }).then).toBe("undefined");
    expect(clean.kind).toBe("written");
    expect(dirty.kind).toBe("focused-dirty");

    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/utils/openWriteGuard.ts"),
      "utf-8",
    );
    // Code only: prose in comments may name `await` without breaking the contract.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\basync\b|\bawait\b|\.then\(/);
    expect(source).not.toContain("console.log");
    expect(source.split("\n").length).toBeLessThan(300);
  });

  it("A-11 two candidates: the dirty path match wins over a clean id match", () => {
    const X = doc("doc-t", "/tmp/elsewhere.md", "X-BODY", false);
    const Z = doc("doc-z", "/tmp/t.md", "Z-EDIT", true);
    seed([docO(false), structuredClone(X), structuredClone(Z)], "doc-t");
    const pre = snapshot();

    const result = commitOpenedDocument(decodedT(), "file-open");

    expect(result).toEqual({ kind: "focused-dirty", matchedBy: "path", document: Z });
    expect(docs()).toEqual(pre.documents);
    expect(docById("doc-t")).toEqual(X);
    expect(activeIds()).toEqual(["doc-z", "doc-z"]);
  });

  it("A-12 large-file flag boundary", () => {
    const sizes: Array<[number | null, boolean]> = [
      [null, false],
      [10485760, false],
      [10485761, true],
    ];
    for (const [fileSize, large] of sizes) {
      seed([docO(false), doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", false)], "doc-t");
      const result = commitOpenedDocument(decodedT({ fileSize }), "file-open");
      expect(result, `size ${fileSize}`).toMatchObject({ kind: "written", largeFile: large });
    }
    seed([docO(false), doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", true)], "doc-t");
    const dirty = commitOpenedDocument(decodedT({ fileSize: 10485761 }), "file-open");
    expect(dirty.kind).toBe("focused-dirty");
    expect("largeFile" in dirty).toBe(false);
  });

  it("A-13 logging: file.open.* events, no content", () => {
    // Row 1: the A-3 shape with buffer BUF-SENTINEL.
    const X = doc("doc-t", "/tmp/renamed.md", "BUF-SENTINEL", true);
    seed([docO(false), structuredClone(X)], "doc-t");
    let start = logCalls().length;
    commitOpenedDocument(decodedT(), "file-open");
    const focus = eventsSince(start, "file.open.focus_dirty");
    expect(focus.length).toBe(1);
    expect(focus[0].context).toEqual({
      documentId: "doc-t", entry: "file-open", matchedBy: "id", flushFailed: false,
    });
    expect(docById("doc-t")).toEqual(X);
    expect(activeIds()).toEqual(["doc-t", "doc-t"]);

    // Row 2: the A-7 shape with decoded DISK-SENTINEL.
    seed([docO(false), doc("doc-t", "/tmp/t.md", "OLD-SENTINEL", false)], "doc-t");
    start = logCalls().length;
    const decoded = decodedT();
    commitOpenedDocument(decoded, "file-open");
    expect(eventsSince(start, "file.open.reload_clean").length).toBe(1);
    expect(docById("doc-t")).toEqual(decoded);
    expect(useMilkdownEditorStore.getState().editorGenerations["doc-t"]).toBe(4);

    for (const call of sink.logEventSync.mock.calls) {
      const s = JSON.stringify(call);
      expect(s.includes("BUF-SENTINEL")).toBe(false);
      expect(s.includes("DISK-SENTINEL")).toBe(false);
    }
  });

  it("A-14 a dirty id match beats a clean path match, in both array orders", () => {
    for (const order of ["X-first", "Z-first"] as const) {
      removeFlushers();
      const X = doc("doc-t", "/tmp/elsewhere.md", "X-EDIT", true);
      const Z = doc("doc-z", "/tmp/t.md", "Z-BODY", false);
      seed(order === "X-first" ? [docO(false), X, Z] : [docO(false), Z, X], "doc-t");
      const pre = snapshot();
      installFlusher("doc-o", "clean");
      const start = logCalls().length;

      const result = commitOpenedDocument(decodedT(), "file-open");

      expect(result, order).toEqual({ kind: "focused-dirty", matchedBy: "id", document: X });
      const post = snapshot();
      expect(post.documents, order).toEqual(pre.documents);
      expect(post.documents.length, order).toBe(3);
      expect(post.generations, order).toEqual(pre.generations);
      expect(post.toc, order).toEqual(pre.toc);
      expect(activeIds(), order).toEqual(["doc-t", "doc-t"]);
      const focus = eventsSince(start, "file.open.focus_dirty");
      expect(focus.length, order).toBe(1);
      expect(focus[0].context, order).toEqual({
        documentId: "doc-t", entry: "file-open", matchedBy: "id", flushFailed: false,
      });
      expect(eventsSince(start, "file.open.reload_clean").length, order).toBe(0);
    }
  });

  it("A-15 the id match is preferred when both are dirty, and on a failed flush", () => {
    const rows = [
      { name: "both-dirty", x: ["X-EDIT", true], z: ["Z-EDIT", true], flush: "clean" },
      { name: "failed-none-dirty", x: ["X-BODY", false], z: ["Z-BODY", false], flush: "failed" },
    ] as const;
    let count = 0;
    for (const row of rows) {
      for (const order of ["X-first", "Z-first"] as const) {
        const label = `${row.name}/${order}`;
        removeFlushers();
        const X = doc("doc-t", "/tmp/elsewhere.md", row.x[0], row.x[1]);
        const Z = doc("doc-z", "/tmp/t.md", row.z[0], row.z[1]);
        seed(order === "X-first" ? [docO(false), X, Z] : [docO(false), Z, X], "doc-t");
        const pre = snapshot();
        installFlusher("doc-o", row.flush);
        const start = logCalls().length;

        const result = commitOpenedDocument(decodedT(), "file-open");

        expect(result, label).toEqual({ kind: "focused-dirty", matchedBy: "id", document: X });
        const post = snapshot();
        expect(post.documents, label).toEqual(pre.documents);
        expect(post.generations, label).toEqual(pre.generations);
        expect(post.toc, label).toEqual(pre.toc);
        expect(activeIds(), label).toEqual(["doc-t", "doc-t"]);
        const focus = eventsSince(start, "file.open.focus_dirty");
        expect(focus.length, label).toBe(1);
        expect(focus[0].context, label).toEqual({
          documentId: "doc-t", entry: "file-open", matchedBy: "id",
          flushFailed: row.flush === "failed",
        });
        count += 1;
      }
    }
    expect(count).toBe(4);
  });

  it("A-16 two-candidate law table (80 rows)", () => {
    const rows = runA16Rows();
    expect(rows.length).toBe(80);
    const focusRows = rows.filter((r) => r.kind === "focused-dirty");
    expect(focusRows.length).toBe(72);
    expect(rows.filter((r) => r.kind === "written").length).toBe(8);
    expect(focusRows.filter((r) => r.matchedBy === "path").length).toBe(20);
    expect(focusRows.filter((r) => r.matchedBy === "id").length).toBe(52);
    expect(focusRows.filter((r) => r.groupKey.endsWith("|failed")).length).toBe(16);
    expectGroupsUniform(rows);
  });

  it("A-1 ∪ A-16 S6 relation: store unchanged iff a candidate is dirty or the flush failed with one present (128 rows)", () => {
    const rows = [...runA1Rows(), ...runA16Rows()];
    expect(rows.length).toBe(128);
    for (const r of rows) {
      expect(r.unchanged, r.label).toBe(r.lawSaysUnchanged);
    }
    expect(rows.filter((r) => r.unchanged).length).toBe(102);
    expect(rows.filter((r) => !r.unchanged).length).toBe(26);
  });

  it("A-17 duplicate paths: first dirty path match, then first path match", () => {
    const rows = [
      { name: "second-dirty", p1: ["P1-BODY", false], p2: ["P2-EDIT", true], flush: "clean", focused: "doc-p2" },
      { name: "both-dirty", p1: ["P1-EDIT", true], p2: ["P2-EDIT", true], flush: "clean", focused: "doc-p1" },
      { name: "failed-none-dirty", p1: ["P1-BODY", false], p2: ["P2-BODY", false], flush: "failed", focused: "doc-p1" },
    ] as const;
    for (const row of rows) {
      removeFlushers();
      const P1 = doc("doc-p1", "/tmp/t.md", row.p1[0], row.p1[1]);
      const P2 = doc("doc-p2", "/tmp/t.md", row.p2[0], row.p2[1]);
      seed([docO(false), P1, P2], "doc-p1", GENERATIONS_NO_T);
      const pre = snapshot();
      installFlusher("doc-o", row.flush);
      const start = logCalls().length;

      const result = commitOpenedDocument(decodedT(), "file-open");

      const focusedDoc = row.focused === "doc-p1" ? P1 : P2;
      expect(result, row.name).toEqual({ kind: "focused-dirty", matchedBy: "path", document: focusedDoc });
      const post = snapshot();
      expect(post.documents, row.name).toEqual(pre.documents);
      expect(post.documents.length, row.name).toBe(3);
      expect(docById("doc-t"), row.name).toBeUndefined();
      expect(post.generations, row.name).toEqual(pre.generations);
      expect("doc-t" in post.generations, row.name).toBe(false);
      expect(post.toc, row.name).toEqual(pre.toc);
      expect(activeIds(), row.name).toEqual([row.focused, row.focused]);
      const focus = eventsSince(start, "file.open.focus_dirty");
      expect(focus.length, row.name).toBe(1);
      expect(focus[0].context, row.name).toEqual({
        documentId: row.focused, entry: "file-open", matchedBy: "path",
        flushFailed: row.flush === "failed",
      });
      expect(eventsSince(start, "file.open.reload_clean").length, row.name).toBe(0);
    }
  });
});

// --- Unit B -------------------------------------------------------------------

describe("Unit B — focusDirtyOpenAt", () => {
  it("B-1 law table: match × flush, each row called twice (9 rows)", () => {
    let rows = 0;
    let returning = 0;
    for (const match of ["dirty", "clean", "none"] as const) {
      for (const flush of FLUSHES_1) {
        const label = `B-1 ${match}/${flush}`;
        removeFlushers();
        const target = match === "none" ? null : doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", match === "dirty");
        seed([docO(false), ...(target ? [target] : [])], "doc-t");
        const pre = snapshot();
        const writeTo = target ? "doc-t" : "doc-o";
        const fl = installFlusher(
          writeTo,
          flush === "written" ? { writeTo, content: (target?.content ?? "OTHER") + "+P" } : flush,
        );

        const first = focusDirtyOpenAt("/tmp/t.md");
        const second = focusDirtyOpenAt("/tmp/t.md");
        const sPost = fl.sPost ?? pre.documents;

        const returns = match !== "none" && (match === "dirty" || flush !== "clean");
        const expected = returns ? sPost.find((d) => d.id === "doc-t") : null;
        expect(first, label).toEqual(expected);
        expect(second, label).toEqual(first);
        const post = snapshot();
        expect(post.documents, label).toEqual(sPost);
        expect(post.generations, label).toEqual(pre.generations);
        expect(post.toc, label).toEqual(pre.toc);
        const active = returns ? "doc-t" : "doc-o";
        expect(activeIds(), label).toEqual([active, active]);
        rows += 1;
        if (first) returning += 1;
      }
    }
    expect(rows).toBe(9);
    expect(returning).toBe(5);
  });

  it("B-2 empty and near-miss paths match nothing", () => {
    seed(
      [docO(false), doc("u", null, "EDIT", true), doc("doc-t", "/tmp/t.md", "BUF-SENTINEL", true)],
      "doc-t",
    );
    const pre = snapshot();
    for (const p of ["", "/tmp/t.md ", "/tmp/t", "/tmp/T.md"]) {
      expect(focusDirtyOpenAt(p), JSON.stringify(p)).toBeNull();
    }
    expect(snapshot()).toEqual(pre);
    expect(activeIds()).toEqual(["doc-o", "doc-o"]);
  });

  it("B-3 duplicate paths on the decode-failure exit: first dirty, then first match", () => {
    const rows = [
      { name: "second-dirty", p1: ["P1-BODY", false], p2: ["P2-EDIT", true], flush: "clean", focused: "doc-p2" },
      { name: "both-dirty", p1: ["P1-EDIT", true], p2: ["P2-EDIT", true], flush: "clean", focused: "doc-p1" },
      { name: "failed-none-dirty", p1: ["P1-BODY", false], p2: ["P2-BODY", false], flush: "failed", focused: "doc-p1" },
    ] as const;
    for (const row of rows) {
      removeFlushers();
      const P1 = doc("doc-p1", "/tmp/t.md", row.p1[0], row.p1[1]);
      const P2 = doc("doc-p2", "/tmp/t.md", row.p2[0], row.p2[1]);
      seed([docO(false), P1, P2], "doc-p1", GENERATIONS_NO_T);
      const pre = snapshot();
      installFlusher("doc-o", row.flush);
      const start = logCalls().length;

      const result = focusDirtyOpenAt("/tmp/t.md");

      expect(result, row.name).toEqual(row.focused === "doc-p1" ? P1 : P2);
      const post = snapshot();
      expect(post.documents, row.name).toEqual(pre.documents);
      expect(post.documents.length, row.name).toBe(3);
      expect(docById("doc-t"), row.name).toBeUndefined();
      expect(post.generations, row.name).toEqual(pre.generations);
      expect("doc-t" in post.generations, row.name).toBe(false);
      expect(post.toc, row.name).toEqual(pre.toc);
      expect(activeIds(), row.name).toEqual([row.focused, row.focused]);
      const focus = eventsSince(start, "file.open.focus_dirty");
      expect(focus.length, row.name).toBe(1);
      expect(focus[0].context, row.name).toMatchObject({
        documentId: row.focused, matchedBy: "path", flushFailed: row.flush === "failed",
      });
    }
  });
});
