/**
 * Purpose: shared fixture for the D58 files (`tests/mcp-table-action-d58*.test.ts`,
 * `tests/milkdown-editor-store-flush-for.test.ts`), per matrix
 * `.claude/tdd-guardian/tests-20261009-131500.md` §0.5–0.7.
 *
 * Holds no mocks: each test file mocks `@tauri-apps/api/core` itself (hoisted per file)
 * and hands its `invoke` to `bindInvoke`, so the log readers here observe `log_event`
 * calls at the Tauri boundary through the real `loggingService`. Every store, the
 * edit-sync controller and `applyMcpTableAction` are real. The Milkdown editor is a fake
 * (`fakeEditor`) over a real ProseMirror `EditorState`, and the real `replaceAll` closure
 * runs unmodified against its recording ctx.
 */
import { expect, type Mock } from "vitest";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import { Schema, type Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useEditorStore } from "../../src/stores/editorStore";
import { useMilkdownEditorStore, type Flusher } from "../../src/stores/milkdownEditorStore";
import { useTOCStore } from "../../src/stores/tocStore";
import { applyMcpTableAction } from "../../src/utils/tableMcp";
import type { TableActionEvent } from "../../src/hooks/mcpTableAction";
import type { EditSyncController } from "../../src/plugins/milkdown/editSync/controller";
import { makeDoc } from "./mcpInsertD35Fixture";

export { content, deps, gen, makeDoc, pending, register } from "./mcpInsertD35Fixture";

const TOC_INITIAL = useTOCStore.getState();

// ---------------------------------------------------------------------------
// Constants (§0.7)
// ---------------------------------------------------------------------------

/** `A_SAME`: the identity cell write, used as the table formatter. */
export const canon = (x: string): string | null =>
  applyMcpTableAction(x, "set_cell", { row: 1, col: 0, content: "1" });

export const F = canon("Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nOutro") as string;
export const F2 = canon("| a | b |\n| - | - |\n| 1 | 2 |\n\nTail") as string;
export const TYPED = " D58-PENDING-TYPED";
export const P = F + TYPED;
export const CELL = "D58-SECRET-CELL";
export const DOCB = "| p | q |\n| - | - |\n| 3 | 4 |";
/** Non-canonical table for INT-3 (real parser). */
export const R = "| a |  b |\n|---|---|\n| 1 |  2 |";
/** Padded only by whitespace for P2b. The separator is already canonical (`---`): the
 *  formatter rewrites `-` to `---`, which is not whitespace (§0.7 escape clause). */
export const Rp = "Intro\n\n| a |  b |\n| --- | --- |\n| 1 |    2 |\n\nOutro";
export const SENTINELS = ["D58-SECRET-CELL", "D58-PENDING-TYPED"] as const;

export const PLUGIN_THROW = "D58 simulated plugin view-update failure";
export const PARSER_THROW = "D58 simulated parser failure";
export const DISPATCH_THROW = "D58 simulated dispatch failure";
export const VIEW_CTX_THROW = "D58 simulated view ctx failure";
export const SERIALIZER_THROW = "D58 simulated serializer failure";

/** D153: the Rust-minted id every fixture event carries; every handler log line reuses it. */
export const D58_ACTION_ID = "d58-action-id";

/** Build a table event; defaults to EV (set_cell CELL on doc-a, window "main"). */
export function tableEvt(overrides: Partial<TableActionEvent> = {}): TableActionEvent {
  return {
    document_id: "doc-a",
    action: "set_cell",
    payload: { row: 1, col: 0, content: CELL },
    window_label: "main",
    action_id: D58_ACTION_ID,
    ...overrides,
  };
}

export const EV = tableEvt();
export const SAME = tableEvt({ payload: { row: 1, col: 0, content: "1" } });
export const ADD_ROW = tableEvt({ action: "add_row", payload: { after: 0 } });
export const DEL_99 = tableEvt({ action: "delete_row", payload: { index: 99 } });

/** The oracle: what the event computes over `x`. */
export const A = (x: string, e: TableActionEvent = EV): string | null =>
  applyMcpTableAction(x, e.action, e.payload);

/** §0.7 preconditions; a failure here means a fixture would pass vacuously. */
export function assertPreconditions(): void {
  for (const x of [F, P, F2]) expect(A(x), "A(x) must be non-null").not.toBeNull();
  expect(A(DOCB)).not.toBeNull();
  expect(A(P)).toContain(TYPED.trim());
  expect(A(P)).toContain(CELL);
  expect(canon(F)).toBe(F);
  expect(canon(F2)).toBe(F2);
  expect(canon(P)).toBe(P);
  for (const x of [F, F2]) {
    expect(A(x, EV)).not.toBe(x);
    expect(A(x, ADD_ROW)).not.toBeNull();
    expect(A(x, ADD_ROW)).not.toBe(x);
    expect(A(x, DEL_99)).toBeNull();
  }
  expect(canon(R)).not.toBeNull();
  expect(canon(R)).not.toBe(R);
  const rp = canon(Rp);
  expect(rp).not.toBeNull();
  expect(rp).not.toBe(Rp);
  expect(rp!.replace(/\s+/g, " ")).toBe(Rp.replace(/\s+/g, " "));
}

// ---------------------------------------------------------------------------
// Store fixture
// ---------------------------------------------------------------------------

export interface Snapshot {
  content: string | undefined;
  isModified: boolean | undefined;
}

export function snapshot(id: string): Snapshot {
  const doc = useDocumentStore.getState().getDocumentById(id);
  return { content: doc?.content, isModified: doc?.isModified };
}

export function resetTableFixture({
  docA = F,
  docB = DOCB,
  active = "doc-a",
  viewMode = "wysiwyg",
}: { docA?: string; docB?: string; active?: string; viewMode?: "wysiwyg" | "source" } = {}): void {
  useDocumentStore.setState({
    documents: [makeDoc("doc-a", docA), makeDoc("doc-b", docB)],
    activeDocumentId: active,
  });
  useEditorStore.setState({ viewMode, editorView: null });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: {} });
  useTOCStore.setState(TOC_INITIAL, true);
}

/** A raw registration: `fn` is the flusher itself, with no controller behind it. */
export function customFlusher(id: string, fn: Flusher): () => void {
  return useMilkdownEditorStore.getState().registerFlusher(id, fn);
}

// ---------------------------------------------------------------------------
// The fake Milkdown editor (§0.6)
// ---------------------------------------------------------------------------

export type FakeMode =
  | "ok"
  | "parseNull"
  | "parseThrows"
  | "dropDispatch"
  | "throwAfterDispatch"
  | "throwInDispatch"
  | "viewCtxThrows"
  | "throwAfterDispatchSerializerThrows"
  | "collapseWs"
  | "sim";

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} },
});

function fakeParse(md: string, collapse: boolean): PmNode {
  const text = collapse ? md.replace(/\s+/g, " ") : md;
  return schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
}

export interface FakeEditor {
  /** What `getEditor()` returns. */
  editor: { action: <T>(fn: (ctx: unknown) => T) => T };
  /** Mutable, so a sequence (L2) can switch the failure mode for one step. */
  mode: FakeMode;
  parseCalls: number;
  dispatchCalls: number;
  storeAtDispatch: Snapshot[];
  docBefore: PmNode;
  viewText: () => string;
  viewDoc: () => PmNode;
  /** A user edit on the view, outside any dispatch recording (L2 `type`). */
  typeAtEnd: (text: string) => void;
  /** `sim`: notify this controller after every applied transaction. */
  attach: (controller: EditSyncController) => void;
}

/** Build the fake and register it as the live Milkdown editor. */
export function fakeEditor(mode: FakeMode, initialText: string, docId = "doc-a"): FakeEditor {
  const collapse = mode === "collapseWs";
  const identitySerializer = mode === "sim";
  let state = EditorState.create({ schema, doc: fakeParse(initialText, collapse) });
  let controller: EditSyncController | null = null;
  const advancingThrow = (m: FakeMode) =>
    m === "throwAfterDispatch" || m === "throwAfterDispatchSerializerThrows";

  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      fake.dispatchCalls += 1;
      fake.storeAtDispatch.push(snapshot(docId));
      if (fake.mode === "dropDispatch") return;
      if (fake.mode === "throwInDispatch") throw new Error(DISPATCH_THROW);
      state = state.apply(tr);
      controller?.onDocChanged({ userEdit: true });
      if (advancingThrow(fake.mode)) throw new Error(PLUGIN_THROW);
    },
  };
  const parser = (md: string): PmNode | null => {
    fake.parseCalls += 1;
    if (fake.mode === "parseNull") return null;
    if (fake.mode === "parseThrows") throw new Error(PARSER_THROW);
    return fakeParse(md, collapse);
  };
  const serializer = (doc: PmNode): string => {
    if (fake.mode === "throwAfterDispatchSerializerThrows") throw new Error(SERIALIZER_THROW);
    return identitySerializer ? doc.textContent : "SER:" + doc.textContent;
  };
  const ctx = {
    get(slice: unknown): unknown {
      if (slice === editorViewCtx) {
        if (fake.mode === "viewCtxThrows") throw new Error(VIEW_CTX_THROW);
        return view;
      }
      if (slice === parserCtx) return parser;
      if (slice === serializerCtx) return serializer;
      throw new Error("D58 fake ctx: unexpected slice");
    },
  };

  const fake: FakeEditor = {
    editor: { action: (fn) => fn(ctx) },
    mode,
    parseCalls: 0,
    dispatchCalls: 0,
    storeAtDispatch: [],
    docBefore: state.doc,
    viewText: () => state.doc.textContent,
    viewDoc: () => state.doc,
    typeAtEnd: (text) => {
      state = state.apply(state.tr.insertText(text, state.doc.content.size - 1));
      controller?.onDocChanged({ userEdit: true });
    },
    attach: (c) => {
      controller = c;
    },
  };
  useMilkdownEditorStore.setState({ getEditor: () => fake.editor });
  return fake;
}

// ---------------------------------------------------------------------------
// Log readers (§0.3) and the D58-7 / D58-7b checks
// ---------------------------------------------------------------------------

export interface LogPayload {
  level: string;
  event: string;
  status?: string;
  actionId?: string;
  context?: Record<string, unknown>;
  error?: string;
}

let boundInvoke: Mock | null = null;

/** Hand the file's hoisted `invoke` mock to the readers below. */
export function bindInvoke(invoke: Mock): void {
  boundInvoke = invoke;
}

type LogCall = [string, { payload: LogPayload }];

export function allLogs(): LogPayload[] {
  if (!boundInvoke) throw new Error("bindInvoke was not called");
  return (boundInvoke.mock.calls as unknown as LogCall[])
    .filter(([cmd]) => cmd === "log_event")
    .map(([, a]) => a.payload);
}

export const logs = (event: string): LogPayload[] => allLogs().filter((p) => p.event === event);
export const tableLogs = (): LogPayload[] => allLogs().filter((p) => p.event.startsWith("mcp.table."));
export const flushContexts = (): Array<Record<string, unknown> | undefined> =>
  logs("editor.milkdown.flush").map((p) => p.context);

// D153: every handler line carries `stage: "applied"` and the event's `action_id`.
export const successLog = (action: string, documentId: string): LogPayload => ({
  level: "info",
  event: `mcp.table.${action}`,
  status: "success",
  actionId: D58_ACTION_ID,
  context: { documentId, stage: "applied" },
});

export const failLog = (
  action: string,
  context: Record<string, unknown>,
): LogPayload => ({
  level: "warn",
  event: `mcp.table.${action}`,
  status: "fail",
  actionId: D58_ACTION_ID,
  // Key order matches the handler's, for the JSON-equality law checks.
  context: { documentId: context.documentId, stage: "applied", ...context },
});

/** D58-7: neither sentinel appears in any serialized `log_event` call. */
export function sentinelViolations(sentinels: readonly string[] = SENTINELS): string[] {
  const text = JSON.stringify(allLogs());
  return sentinels.filter((s) => text.includes(s)).map((s) => `sentinel in logs: ${s.length} chars`);
}

export function expectNoSentinelInLogs(sentinels: readonly string[] = SENTINELS): void {
  expect(sentinelViolations(sentinels)).toEqual([]);
}

const PLAIN_REASONS = new Set([
  "not found",
  "invalid payload",
  "flush failed",
  "editor unavailable",
  "editor did not apply",
]);
const ERROR_REASONS = new Set(["milkdown replaceAll threw", "codemirror dispatch threw"]);
const FLUSH_TOP = new Set(["level", "event", "status", "actionId", "context", "error"]);

const keysOf = (o: object | undefined): string => Object.keys(o ?? {}).sort().join(",");

function tableContextOk(ctxWithStage: Record<string, unknown>, status: string | undefined): boolean {
  const { stage, ...ctx } = ctxWithStage;
  if (stage !== "applied") return false; // D153
  const keys = keysOf(ctx);
  if (status === "success") return keys === "documentId";
  if (keys === "documentId,reason") return PLAIN_REASONS.has(ctx.reason as string);
  if (keys === "documentId,error,reason") return ERROR_REASONS.has(ctx.reason as string);
  if (keys === "documentId,error,reason,storeReconciled") {
    return ctx.reason === "milkdown replaceAll threw" && ctx.storeReconciled === true;
  }
  return false;
}

/**
 * D58-7b: the closed-world log grammar. With `onlyAllowed`, events outside the allowed
 * set are skipped instead of reported (INT applies rules 2–4 only).
 */
export function closedWorldViolations(actions: readonly string[], onlyAllowed = false): string[] {
  const out: string[] = [];
  const tableEvents = new Set(actions.map((a) => `mcp.table.${a}`));
  for (const p of allLogs()) {
    const isFlush = p.event === "editor.milkdown.flush";
    const isTable = tableEvents.has(p.event);
    if (!isFlush && !isTable) {
      if (!onlyAllowed) out.push(`event outside the closed set: ${p.event}`);
      continue;
    }
    const ctx = p.context ?? {};
    for (const [k, v] of Object.entries(ctx)) {
      const okType = k === "storeReconciled" ? typeof v === "boolean" : typeof v === "string";
      if (!okType) out.push(`${p.event}: context.${k} has type ${typeof v}`);
    }
    if (isFlush) {
      if (keysOf(ctx) !== "documentId,outcome,reason") out.push(`flush context keys: ${keysOf(ctx)}`);
      const extra = Object.keys(p).filter((k) => !FLUSH_TOP.has(k));
      if (extra.length) out.push(`flush top-level keys: ${extra.join(",")}`);
      if (("error" in p) !== (p.status === "fail")) out.push("flush: error present iff status fail");
    } else {
      if (keysOf(p) !== "actionId,context,event,level,status") out.push(`${p.event} top-level keys: ${keysOf(p)}`);
      if (!tableContextOk(ctx, p.status)) out.push(`${p.event} context shape: ${keysOf(ctx)} / ${String(ctx.reason)}`);
    }
  }
  return out;
}

export function expectClosedLogWorld(actions: readonly string[]): void {
  expect(closedWorldViolations(actions)).toEqual([]);
}
