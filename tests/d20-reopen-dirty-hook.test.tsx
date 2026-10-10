/**
 * D20 / ADR-0028 WI-2 — the three `useDocument` open entry points write through the guard.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260924-105300.md`, Unit D (D-1..D-13, D-3a, D-3b),
 * E-R6 (real editor, decode-failure exit) and the L-1 log sweep for this file.
 *
 * Law under test: a buffer that is dirty when the read lands is never replaced — on every
 * entry point, on both exits (successful read, decode failure), with "dirty" judged after a
 * "reopen" flush. A clean target is always replaced.
 *
 * Mock boundary (matrix §0): `@tauri-apps/api/{core,event,window}` and the `loggingService`
 * recording sink. `invoke` is held through `tests/helpers/heldInvoke.ts`. Every store is
 * real; flusher doubles go through the public `registerFlusher` seam.
 *
 * E-R6 deviation from the matrix text: it names `typeAtEnd`, but a history-recorded edit
 * marks the doc dirty synchronously (editSync/controller.ts `onDocChanged`), which breaks
 * its own PENDING-PRECONDITION. `typeHistoryless` keeps the store clean with the edit
 * pending, which is the state the precondition asks for.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";

const { invokeMock, sink } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  sink: {
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
  },
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({ loggingService: sink }));

import type { Editor } from "@milkdown/kit/core";
import { useDocument } from "../src/hooks/useDocument";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTOCStore } from "../src/stores/tocStore";
import type { Document } from "../src/types/document";
import { A_PATH, createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import {
  makeDoc, mountAndWait, resetStores as resetEditorStores, sleep, typeHistoryless,
} from "./helpers/milkdownEditorHarness";

const SENTINELS = [
  "BASE", "BASE+W", "BASE+EDIT", "BASE+PENDING", "DISK", "MCP-WRITE", "DECODED", "B-EDIT",
  "EDIT", "E-R6-OLD-SENTINEL", "E-R6-NEW-SENTINEL",
] as const;

type Api = ReturnType<typeof useDocument>;
type HookResult = { current: Api };

const TOC_INITIAL = useTOCStore.getState();
const GENERATIONS: Record<string, number> = { "doc-a": 3, "doc-b": 5, "doc-x": 7 };
const WARNING = "Large file opened (>10MB). Performance may be affected.";
const LARGE = 10 * 1024 * 1024;
const encErr = (p: string, detected = "unknown") => ({ EncodingError: { path: p, detected } });

let held: HeldInvoke;
let unmounts: Array<() => void> = [];
let cleanups: Array<() => void> = [];

function doc(id: string, content: string, p: string | null, isModified: boolean): Document {
  return { id, path: p, content, encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}
const decodedA = (over: Partial<Document> = {}): Document => ({ ...doc("doc-a", "DISK", A_PATH, false), ...over });
const docs = () => useDocumentStore.getState().documents;
const byId = (id: string) => docs().find((d) => d.id === id);
const gen = (id: string) => useMilkdownEditorStore.getState().editorGenerations[id] ?? 0;
const activeIds = () => [useDocumentStore.getState().activeDocumentId, useEditorStore.getState().activeDocumentId];

/** doc-b is active in both stores, so activation of doc-a is observable. */
function seed(list: Document[]): void {
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  useDocumentStore.setState({ documents: list, activeDocumentId: "doc-b" });
  useEditorStore.setState({ activeDocumentId: "doc-b", viewMode: "source" });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: { ...GENERATIONS } });
  useTOCStore.setState(TOC_INITIAL, true);
}

function hook(): HookResult {
  const { result, unmount } = renderHook(() => useDocument());
  unmounts.push(unmount);
  return result;
}

// Overloads: the entry tables' `run` is a union across entry points, which a lone
// generic signature cannot infer; the `unknown` overload accepts it.
function call<T>(r: HookResult, run: (api: Api) => Promise<T>): Promise<T>;
function call(r: HookResult, run: (api: Api) => Promise<unknown>): Promise<unknown>;
async function call<T>(r: HookResult, run: (api: Api) => Promise<T>): Promise<T> {
  let out!: T;
  await act(async () => { out = await run(r.current); });
  return out;
}

/** Start `run`, wait until `cmd` is held, run `during`, then release with `value`. */
function heldCall<T>(r: HookResult, run: (api: Api) => Promise<T>, cmd: string, value: unknown, during?: () => void): Promise<T>;
function heldCall(r: HookResult, run: (api: Api) => Promise<unknown>, cmd: string, value: unknown, during?: () => void): Promise<unknown>;
async function heldCall<T>(r: HookResult, run: (api: Api) => Promise<T>, cmd: string, value: unknown, during?: () => void): Promise<T> {
  held.hold(cmd);
  let p!: Promise<T>;
  await act(async () => { p = run(r.current); await held.whenCalled(cmd); });
  if (during) act(during);
  let out!: T;
  await act(async () => { held.release(cmd, value); out = await p; });
  return out;
}

const rejectWith = (cmd: string, error: unknown) => held.reply(cmd, () => Promise.reject(error));

/** D-3a / D-3b flusher double on doc-a, at the public seam. */
function installFlusher(mode: "pending" | "failed"): string[] {
  const reasons: string[] = [];
  let pending = mode === "pending";
  cleanups.push(useMilkdownEditorStore.getState().registerFlusher("doc-a", (reason) => {
    reasons.push(reason);
    if (mode === "failed") return { status: "failed" };
    if (!pending) return { status: "clean" };
    pending = false;
    useDocumentStore.getState().updateDocumentContent("doc-a", "BASE+PENDING");
    return { status: "written" };
  }));
  return reasons;
}

const ENTRIES = {
  path: { cmd: "open_file", run: (api: Api) => api.openDocumentFromPath(A_PATH) },
  dialog: { cmd: "open_file_dialog", run: (api: Api) => api.openDocumentFromDialog() },
  encoding: { cmd: "open_file", run: (api: Api) => api.openDocumentWithEncoding(A_PATH, "GBK") },
} as const;
const DECODE_ENTRIES = { path: ENTRIES.path, dialog: ENTRIES.dialog } as const;

// --- L-1 sweep ----------------------------------------------------------------

const swept = { total: 0, focusDirty: 0 };
const errorReplacer = (_k: string, v: unknown) =>
  v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;

beforeEach(() => { seed([doc("doc-a", "BASE", A_PATH, false), doc("doc-b", "B-EDIT", null, false)]); });

afterEach(() => {
  for (const u of unmounts) u();
  unmounts = [];
  for (const c of cleanups) c();
  cleanups = [];
  const testName = expect.getState().currentTestName ?? "<unknown>";
  for (const fn of Object.values(sink)) {
    for (const args of fn.mock.calls) {
      swept.total += 1;
      const first = args[0] as { event?: string } | undefined;
      if (fn === sink.logEventSync && first?.event === "file.open.focus_dirty") swept.focusDirty += 1;
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
});

// --- Unit D -------------------------------------------------------------------

describe("D — the open entry points never replace a buffer dirty at landing", () => {
  it("D-1 law table: entry × dirtiness-at-landing (held invoke)", async () => {
    const states = ["clean", "dirty-before", "dirtied-during", "clean+dirty-other"] as const;
    let rows = 0;
    let dirtyRows = 0;
    const hit = new Set<string>();
    for (const [entry, { cmd, run }] of Object.entries(ENTRIES)) {
      for (const state of states) {
        const label = `${entry}/${state}`;
        seed([doc("doc-a", "BASE", A_PATH, state === "dirty-before"), doc("doc-b", "B-EDIT", null, state === "clean+dirty-other")]);
        const preB = structuredClone(byId("doc-b"));
        const decoded = decodedA();
        const during = state === "dirtied-during"
          ? () => useDocumentStore.getState().updateDocumentContent("doc-a", "BASE+W") : undefined;
        const out = await heldCall(hook(), run, cmd, { document: decoded }, during);
        const dirty = state === "dirty-before" || state === "dirtied-during";
        const expected = entry === "encoding"
          ? (dirty ? { kind: "refused-dirty", documentId: "doc-a" } : { kind: "opened", document: decoded })
          : (dirty ? byId("doc-a") : decoded);
        expect(out, label).toEqual(expected);
        if (dirty) {
          expect(byId("doc-a")?.content, label).toBe(state === "dirtied-during" ? "BASE+W" : "BASE");
          expect(byId("doc-a")?.isModified, label).toBe(true);
          expect(gen("doc-a"), label).toBe(3);
        } else {
          expect(byId("doc-a"), label).toEqual(decoded);
          expect(gen("doc-a"), label).toBe(4);
        }
        expect(docs().filter((d) => d.id === "doc-a").length, label).toBe(1);
        expect(byId("doc-b"), label).toEqual(preB);
        expect(useDocumentStore.getState().activeDocumentId, label).toBe("doc-a");
        held.assertDrained();
        rows += 1;
        if (dirty) dirtyRows += 1;
        hit.add(entry);
      }
    }
    expect(rows).toBe(12);
    expect(dirtyRows).toBe(6);
    expect([...hit].sort()).toEqual(["dialog", "encoding", "path"]);
  });

  it("D-2 the D20 regression: dirtied during the open_file await, path entry", async () => {
    useDocumentStore.setState({ activeDocumentId: "doc-a" });
    const out = await heldCall(hook(), ENTRIES.path.run, "open_file", { document: decodedA() },
      () => useDocumentStore.getState().updateDocumentContent("doc-a", "BASE+EDIT"));
    expect(out).toEqual(byId("doc-a"));
    expect(byId("doc-a")).toMatchObject({ content: "BASE+EDIT", isModified: true });
    expect(gen("doc-a")).toBe(3);
    expect(docs().filter((d) => d.id === "doc-a").length).toBe(1);
  });

  for (const [entry, { cmd, run }] of Object.entries(DECODE_ENTRIES)) {
    it(`D-3 [${entry}] decode failure on a dirty open path: focused, no EncodingDialog`, async () => {
      seed([doc("doc-a", "BASE", A_PATH, true), doc("doc-b", "B-EDIT", null, false)]);
      const pre = structuredClone(byId("doc-a"));
      rejectWith(cmd, encErr(A_PATH));
      const r = hook();
      const out = await call(r, run);
      expect(out).toEqual(pre);
      expect(r.current.encodingIssue).toBeNull();
      expect(byId("doc-a")).toEqual(pre);
      expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    });

    it(`D-3a [${entry}] decode failure, store-clean with a pending edit: the flush dirties it, so it is focused`, async () => {
      const reasons = installFlusher("pending");
      const length = docs().length;
      rejectWith(cmd, encErr(A_PATH));
      const r = hook();
      const out = await call(r, run);
      expect(out).toEqual(byId("doc-a"));
      expect(byId("doc-a")).toMatchObject({ content: "BASE+PENDING", isModified: true });
      expect(r.current.encodingIssue).toBeNull();
      expect(reasons).toEqual(["reopen"]);
      expect(gen("doc-a")).toBe(3);
      expect(activeIds()).toEqual(["doc-a", "doc-a"]);
      expect(docs().length).toBe(length);
    });

    it(`D-3b [${entry}] decode failure, store-clean with a failed flush: focused (decision 5)`, async () => {
      const reasons = installFlusher("failed");
      const pre = structuredClone(docs());
      const preGen = { ...useMilkdownEditorStore.getState().editorGenerations };
      rejectWith(cmd, encErr(A_PATH));
      const r = hook();
      const out = await call(r, run);
      expect(out).toEqual(byId("doc-a"));
      expect(out).toMatchObject({ content: "BASE", isModified: false });
      expect(r.current.encodingIssue).toBeNull();
      expect(reasons).toEqual(["reopen"]);
      expect(docs()).toEqual(pre);
      expect(useMilkdownEditorStore.getState().editorGenerations).toEqual(preGen);
      expect(activeIds()).toEqual(["doc-a", "doc-a"]);
      const focus = sink.logEventSync.mock.calls.map((c) => c[0] as { event: string; context?: object })
        .filter((c) => c.event === "file.open.focus_dirty");
      expect(focus.length).toBe(1);
      expect(focus[0].context).toMatchObject({ flushFailed: true, matchedBy: "path" });
    });
  }

  it("D-4 a message-form decode error on the path entry falls back to the argument path", async () => {
    seed([doc("doc-a", "BASE", A_PATH, true), doc("doc-b", "B-EDIT", null, false)]);
    const pre = structuredClone(byId("doc-a"));
    rejectWith("open_file", new Error("EncodingError: bad bytes"));
    const r = hook();
    expect(await call(r, ENTRIES.path.run)).toEqual(pre);
    expect(r.current.encodingIssue).toBeNull();
    expect(byId("doc-a")).toEqual(pre);
  });

  for (const [row, p] of [["clean-open", A_PATH], ["unopened", "/tmp/new.md"]] as const) {
    it(`D-5 [${row}] decode failure on a clean or unopened path: EncodingDialog as today`, async () => {
      const pre = structuredClone(docs());
      rejectWith("open_file", encErr(p, "GBK"));
      const r = hook();
      expect(await call(r, (api) => api.openDocumentFromPath(p))).toBeNull();
      expect(r.current.encodingIssue).toEqual({ path: p, detected: "GBK" });
      expect(docs()).toEqual(pre);
      expect(activeIds()).toEqual(["doc-b", "doc-b"]);
    });
  }

  it("D-6 Save As shape through openDocumentFromPath(P2): focus on the original id, one tab", async () => {
    seed([doc("doc-x", "EDIT", "/tmp/p2.md", true), doc("doc-b", "B-EDIT", null, false)]);
    const preX = structuredClone(byId("doc-x"));
    held.reply("open_file", () => ({ document: doc("doc-y", "DISK", "/tmp/p2.md", false) }));
    const out = await call(hook(), (api) => api.openDocumentFromPath("/tmp/p2.md"));
    expect(out).toEqual(preX);
    expect(docs().filter((d) => d.path === "/tmp/p2.md").length).toBe(1);
    expect(byId("doc-y")).toBeUndefined();
    expect(byId("doc-x")).toEqual(preX);
    expect(activeIds()).toEqual(["doc-x", "doc-x"]);
  });

  it("D-7 a dirty non-target tab does not block reopening a clean target", async () => {
    seed([doc("doc-a", "BASE", A_PATH, false), doc("doc-b", "B-EDIT", null, true)]);
    const preB = structuredClone(byId("doc-b"));
    const decoded = decodedA();
    held.reply("open_file", () => ({ document: decoded }));
    expect(await call(hook(), ENTRIES.path.run)).toEqual(decoded);
    expect(byId("doc-a")).toMatchObject({ content: "DISK", isModified: false });
    expect(byId("doc-b")).toEqual(preB);
  });

  for (const [entry, { cmd, run }] of Object.entries(ENTRIES)) {
    it(`D-8 [${entry}] a clean reopen replaces the content`, async () => {
      const decoded = decodedA();
      held.reply(cmd, () => ({ document: decoded }));
      const out = await call(hook(), run);
      expect(out).toEqual(entry === "encoding" ? { kind: "opened", document: decoded } : decoded);
      expect(byId("doc-a")).toEqual(decoded);
      expect(gen("doc-a")).toBe(4);
      expect(activeIds()).toEqual(["doc-a", "doc-a"]);
    });
  }

  it("D-9 the encoding reopen race: refusal clears the issue and keeps the buffer", async () => {
    rejectWith("open_file", encErr(A_PATH));
    const r = hook();
    expect(await call(r, ENTRIES.path.run)).toBeNull();
    expect(r.current.encodingIssue).toEqual({ path: A_PATH, detected: "unknown" });
    const out = await heldCall(r, ENTRIES.encoding.run, "open_file", { document: decodedA({ content: "DECODED" }) },
      () => useDocumentStore.getState().updateDocumentContent("doc-a", "MCP-WRITE"));
    expect(out).toEqual({ kind: "refused-dirty", documentId: "doc-a" });
    expect(r.current.encodingIssue).toBeNull();
    expect(byId("doc-a")).toMatchObject({ content: "MCP-WRITE", isModified: true });
    expect(gen("doc-a")).toBe(3);
    expect(activeIds()).toEqual(["doc-a", "doc-a"]);
  });

  it("D-9a id-only shape (Save As): the decode-failure exit matches by path only, so the dialog shows and the re-decode is refused", async () => {
    // doc-a is A_PATH's path-derived id (see decodedA), but its path moved after Save As.
    seed([doc("doc-a", "EDIT", "/tmp/saved-as.md", true), doc("doc-b", "B-EDIT", null, false)]);
    const preA = structuredClone(byId("doc-a"));
    rejectWith("open_file", encErr(A_PATH));
    const r = hook();
    expect(await call(r, ENTRIES.path.run)).toBeNull();
    expect(r.current.encodingIssue).toEqual({ path: A_PATH, detected: "unknown" });
    expect(byId("doc-a")).toEqual(preA);
    held.reply("open_file", () => ({ document: decodedA({ content: "DECODED" }) }));
    const out = await call(r, ENTRIES.encoding.run);
    expect(out).toEqual({ kind: "refused-dirty", documentId: "doc-a" });
    expect(byId("doc-a")).toEqual(preA);
    expect(byId("doc-a")?.content).toBe("EDIT");
    expect(gen("doc-a")).toBe(3);
    expect(docs().filter((d) => d.id === "doc-a").length).toBe(1);
  });

  it("D-10 the dialog's cancel path and its re-throw of non-encoding errors are unchanged", async () => {
    const E = { FileNotFound: { path: "/tmp/gone.md" } };
    const before = docs();
    const r = hook();
    held.reply("open_file_dialog", () => null);
    expect(await call(r, ENTRIES.dialog.run), "cancel").toBeNull();
    rejectWith("open_file_dialog", E);
    let caught: unknown = null;
    await act(async () => { await r.current.openDocumentFromDialog().catch((e: unknown) => { caught = e; }); });
    expect(caught, "rethrow").toBe(E);
    rejectWith("open_file", E);
    expect(await call(r, ENTRIES.path.run), "path-nonencoding").toBeNull();
    expect(docs()).toBe(before);
    expect(r.current.encodingIssue).toBeNull();
  });

  const DIALOG_ROWS = [
    ["unopened", false, encErr("/a.md", "GBK"), { path: "/a.md", detected: "GBK" }],
    ["open-clean", true, encErr("/a.md", "GBK"), { path: "/a.md", detected: "GBK" }],
    ["empty-fields", false, encErr("", ""), { path: "", detected: "unknown" }],
  ] as const;
  for (const [row, openA, error, expected] of DIALOG_ROWS) {
    it(`D-14 [${row}] dialog decode failure on a non-dirty target: EncodingDialog, store unchanged`, async () => {
      seed([
        ...(openA ? [doc("doc-a", "BASE", "/a.md", false)] : []),
        doc("doc-b", "B-EDIT", null, false),
      ]);
      const pre = structuredClone(docs());
      rejectWith("open_file_dialog", error);
      const r = hook();
      expect(await call(r, ENTRIES.dialog.run)).toBeNull();
      expect(r.current.encodingIssue).toEqual(expected);
      expect(docs()).toEqual(pre);
    });
  }

  it("D-15 path decode failure with empty error fields falls back to the argument path and 'unknown'", async () => {
    const pre = structuredClone(docs());
    rejectWith("open_file", encErr("", ""));
    const r = hook();
    expect(await call(r, (api) => api.openDocumentFromPath("/b.md"))).toBeNull();
    expect(r.current.encodingIssue).toEqual({ path: "/b.md", detected: "unknown" });
    expect(docs()).toEqual(pre);
  });

  for (const E of ["boom", 42] as const) {
    it(`D-16 [${typeof E}] dialog re-throws a non-object error unchanged`, async () => {
      rejectWith("open_file_dialog", E);
      const r = hook();
      let caught: unknown = null;
      await act(async () => { await r.current.openDocumentFromDialog().catch((e: unknown) => { caught = e; }); });
      expect(caught).toBe(E);
      expect(r.current.encodingIssue).toBeNull();
    });
  }

  it("D-11 an IPC rejection in openDocumentWithEncoding propagates", async () => {
    rejectWith("open_file", encErr(A_PATH));
    const r = hook();
    await call(r, ENTRIES.path.run);
    const pre = structuredClone(docs());
    const E = { IoError: { message: "boom" } };
    rejectWith("open_file", E);
    let caught: unknown = null;
    await act(async () => { await r.current.openDocumentWithEncoding(A_PATH, "GBK").catch((e: unknown) => { caught = e; }); });
    expect(caught).toBe(E);
    expect(docs()).toEqual(pre);
    expect(r.current.encodingIssue).toEqual({ path: A_PATH, detected: "unknown" });
  });

  it("D-12 the large-file warning through the hook", async () => {
    const rows = [[false, LARGE + 1, WARNING], [false, LARGE, null], [true, LARGE + 1, null]] as const;
    for (const [dirty, fileSize, expected] of rows) {
      seed([doc("doc-a", "BASE", A_PATH, dirty), doc("doc-b", "B-EDIT", null, false)]);
      held.reply("open_file", () => ({ document: decodedA({ fileSize }) }));
      const r = hook();
      await call(r, ENTRIES.path.run);
      expect(r.current.largeFileWarning, `dirty=${dirty} size=${fileSize}`).toBe(expected);
    }
  });

  it("D-13 structural budget: no direct writes, guard routing, at most 300 lines", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/hooks/useDocument.ts"), "utf8");
    const slice = (name: string) => {
      const start = src.indexOf(`const ${name} =`);
      expect(start, name).toBeGreaterThan(-1);
      const end = src.indexOf("\n  const ", start + 1);
      return src.slice(start, end === -1 ? undefined : end);
    };
    // D95: openPathOutcome holds the path open; openDocumentFromPath wraps it.
    for (const name of ["openPathOutcome", "openDocumentFromDialog", "openDocumentWithEncoding"]) {
      const body = slice(name);
      expect(body.includes("prepareWholesaleReplace("), name).toBe(false);
      expect(body.includes("upsertDocument("), name).toBe(false);
      expect(body.includes("commitOpenedDocument("), name).toBe(true);
    }
    for (const name of ["openPathOutcome", "openDocumentFromDialog"]) {
      const body = slice(name);
      const focusAt = body.indexOf("focusDirtyOpenAt(");
      expect(focusAt, name).toBeGreaterThan(-1);
      expect(focusAt, name).toBeLessThan(body.indexOf("setEncodingIssue("));
    }
    expect(src.split("\n").length).toBeLessThanOrEqual(301);
    expect(src.trimEnd().split("\n").length).toBeLessThanOrEqual(300);
  });
});

// --- E-R6: the real flusher on the decode-failure exit ------------------------

describe("real editor", { timeout: 20_000 }, () => {
  const OLD_TEXT = "E-R6-OLD-SENTINEL paragraph";
  const docA = () => byId("doc-a")!;
  const liveEditor = () => useMilkdownEditorStore.getState().getEditor() as Editor | null;

  it("E-R6 a pending edit is kept on a decode failure and EncodingDialog is not shown", async () => {
    installIntersectionObserverDouble();
    resetEditorStores([makeDoc("doc-a", OLD_TEXT, A_PATH), makeDoc("doc-b", "B-EDIT")]);
    const mounted = await mountAndWait();
    unmounts.push(mounted.unmount);
    const old = mounted.instance;
    const genBefore = gen("doc-a");
    await act(async () => typeHistoryless(old, "Q"));
    expect(docA().isModified, "PENDING-PRECONDITION").toBe(false);
    expect(docA().content, "PENDING-PRECONDITION").not.toContain("Q");
    rejectWith("open_file", encErr(A_PATH));
    const r = hook();
    const out = await call(r, ENTRIES.path.run);
    expect(out).toMatchObject({ id: "doc-a", isModified: true });
    await sleep(350);
    expect(r.current.encodingIssue).toBeNull();
    expect(docA().content).toContain("Q");
    expect(docA().content).toContain("E-R6-OLD-SENTINEL");
    expect(docA().isModified).toBe(true);
    expect(liveEditor()).toBe(old);
    expect(gen("doc-a")).toBe(genBefore);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-a");
  });
});
