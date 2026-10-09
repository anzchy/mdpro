/**
 * Purpose: the enumerated domain and oracle for the D58 agreement law (L1, L1b, L2), per
 * matrix `.claude/tdd-guardian/tests-20261009-131500.md`, "Unit: processTableActionEvent —
 * the agreement law (WI-5)". Holds no mocks; the law test file mocks `invoke` and binds it
 * through `bindInvoke`. Kept apart from the test file so a `*.slow.test.ts` sibling can
 * share it (ADR-0050).
 */
import { EditorState as CmState } from "@codemirror/state";
import { EditorView as CmView } from "@codemirror/view";
import { processTableActionEvent, type TableActionEvent } from "../../src/hooks/mcpTableAction";
import { useEditorStore } from "../../src/stores/editorStore";
import { useMilkdownEditorStore } from "../../src/stores/milkdownEditorStore";
import { createEditSyncController } from "../../src/plugins/milkdown/editSync/controller";
import {
  A,
  ADD_ROW,
  DEL_99,
  DOCB,
  EV,
  F,
  F2,
  SAME,
  TYPED,
  closedWorldViolations,
  content,
  deps,
  failLog,
  fakeEditor,
  logs,
  resetTableFixture,
  sentinelViolations,
  snapshot,
  successLog,
  tableLogs,
  type FakeEditor,
  type FakeMode,
  type LogPayload,
  type Snapshot,
} from "../helpers/mcpTableD58Fixture";

export type Target = "wysiwyg-active" | "source-active" | "non-active";
export type FlusherShape = "none" | "clean" | "pending-written" | "failing";
export type EditorCol = "null" | Exclude<FakeMode, "collapseWs" | "sim">;

export interface Row {
  base: string;
  baseName: "F" | "F2";
  target: Target;
  flusher: FlusherShape;
  editor: EditorCol;
  event: TableActionEvent;
  payloadName: "EV" | "add_row" | "delete_row_99" | "SAME";
}

const EDITORS: EditorCol[] = [
  "null",
  "ok",
  "parseNull",
  "parseThrows",
  "dropDispatch",
  "throwAfterDispatch",
  "viewCtxThrows",
  "throwAfterDispatchSerializerThrows",
];
const PAYLOADS = [
  ["EV", EV],
  ["add_row", ADD_ROW],
  ["delete_row_99", DEL_99],
  ["SAME", SAME],
] as const;

/** 2 × 3 × 4 × 8 × 4 = 768 rows. */
export function l1Rows(): Row[] {
  const rows: Row[] = [];
  for (const [baseName, base] of [["F", F], ["F2", F2]] as const)
    for (const target of ["wysiwyg-active", "source-active", "non-active"] as const)
      for (const flusher of ["none", "clean", "pending-written", "failing"] as const)
        for (const editor of EDITORS)
          for (const [payloadName, e] of PAYLOADS) {
            const docId = target === "non-active" ? "doc-b" : "doc-a";
            rows.push({ base, baseName, target, flusher, editor, payloadName, event: { ...e, document_id: docId } });
          }
  return rows;
}

export const rowName = (r: Row) => `${r.baseName}/${r.target}/${r.flusher}/${r.editor}/${r.payloadName}`;

export interface Observed {
  threw: string | null;
  snaps: Record<string, Snapshot>;
  arranged: Record<string, Snapshot>;
  tableLogs: LogPayload[];
  flushLogs: number;
  reloadLogs: number;
  generations: Record<string, number>;
  counters: number[];
  cmText: string | null;
  fake: FakeEditor | null;
  violations: string[];
}

/** Arrange one row from a fresh fixture, drive it, and observe everything. */
export function runRow(row: Row): Observed {
  const docA = row.target === "non-active" ? F : row.base;
  const docB = row.target === "non-active" ? row.base : DOCB;
  resetTableFixture({ docA, docB, active: "doc-a", viewMode: row.target === "source-active" ? "source" : "wysiwyg" });
  let cm: CmView | null = null;
  if (row.target === "source-active") {
    cm = new CmView({ state: CmState.create({ doc: row.base }) });
    useEditorStore.setState({ editorView: cm });
  }
  const counters: number[] = [];
  const holders = row.target === "non-active" ? ["doc-a", "doc-b"] : ["doc-a"];
  if (row.flusher !== "none") for (const id of holders) arrangeFlusher(id, row.flusher, counters);
  let fake: FakeEditor | null = null;
  if (row.editor !== "null") {
    const pre = content("doc-a") as string;
    fake = fakeEditor(row.editor, row.flusher === "pending-written" ? pre + TYPED : pre);
  }
  const arranged = { "doc-a": snapshot("doc-a"), "doc-b": snapshot("doc-b") };
  let threw: string | null = null;
  try {
    processTableActionEvent(row.event, deps);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  const observed: Observed = {
    threw,
    snaps: { "doc-a": snapshot("doc-a"), "doc-b": snapshot("doc-b") },
    arranged,
    tableLogs: tableLogs(),
    flushLogs: logs("editor.milkdown.flush").length,
    reloadLogs: logs("editor.milkdown.reload").length,
    generations: { ...useMilkdownEditorStore.getState().editorGenerations },
    counters,
    cmText: cm ? cm.state.doc.toString() : null,
    fake,
    violations: [...sentinelViolations(), ...closedWorldViolations([row.event.action])],
  };
  cm?.destroy();
  useEditorStore.setState({ editorView: null });
  return observed;
}

/** A real controller behind a counting registration. */
function arrangeFlusher(id: string, shape: FlusherShape, counters: number[]): void {
  const pre = content(id) as string;
  const getMarkdown =
    shape === "failing"
      ? () => {
          throw new Error("D58 law flusher failure");
        }
      : shape === "pending-written"
        ? () => pre + TYPED
        : () => pre;
  const c = createEditSyncController({ documentId: id, getMarkdown, baselineMarkdown: pre });
  const i = counters.push(0) - 1;
  useMilkdownEditorStore.getState().registerFlusher(id, (r) => (counters[i]++, c.flush(r)), c.discard);
  if (shape !== "clean") c.onDocChanged({ userEdit: true });
}

const THREW = "milkdown replaceAll threw";

/** The L1 oracle (matrix precedence 1–14); returns the violations for one row. */
export function checkL1(row: Row, o: Observed): string[] {
  const out: string[] = [];
  const T = row.event.document_id;
  const other = T === "doc-a" ? "doc-b" : "doc-a";
  const act = row.event.action;
  const gate = row.target === "wysiwyg-active";
  const arrangedT = o.arranged[T];
  const base = gate && row.flusher === "pending-written" ? row.base + TYPED : row.base;
  const next = A(base, row.event);
  const fake = o.fake;
  const eq = (what: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  };
  const refused = (reason: string, extra: Record<string, unknown> = {}, store = base) => {
    eq("store", o.snaps[T], { content: store, isModified: arrangedT.isModified });
    eq("table logs", o.tableLogs, [failLog(act, { documentId: T, reason, ...extra })]);
  };
  const applied = (store: string | null) => {
    eq("store", o.snaps[T], { content: store, isModified: true });
    eq("table logs", o.tableLogs, [successLog(act, T)]);
  };
  const calls = () => [fake?.parseCalls ?? 0, fake?.dispatchCalls ?? 0];

  if (o.threw !== null) out.push(`threw: ${o.threw}`);
  if (o.reloadLogs !== 0 || Object.keys(o.generations).length !== 0) out.push("wholesale reload");
  if (o.tableLogs.length !== 1) out.push(`${o.tableLogs.length} mcp.table logs`);
  eq("other document", o.snaps[other], o.arranged[other]);
  out.push(...o.violations);

  if (gate && row.flusher === "failing") refused("flush failed", {}, row.base);
  else if (next === null) refused("invalid payload");
  else if (!gate) {
    applied(next);
    if (row.target === "source-active") eq("codemirror text", o.cmText, next);
    eq("milkdown calls", calls(), [0, 0]);
    eq("flush logs", o.flushLogs, 0);
    eq("flusher counters", o.counters.filter((n) => n !== 0).length, 0);
  } else if (row.editor === "null") refused("editor unavailable");
  else if (row.editor === "viewCtxThrows") {
    refused(THREW, { error: "D58 simulated view ctx failure" });
    eq("milkdown calls", calls(), [0, 0]);
  } else if (row.editor === "parseNull") {
    refused("editor did not apply");
    eq("dispatches", fake?.dispatchCalls, 0);
  } else if (row.editor === "parseThrows") {
    refused(THREW, { error: "D58 simulated parser failure" });
    if (fake?.viewDoc() !== fake?.docBefore) out.push("view identity lost");
  } else if (next === base) {
    applied(next);
    eq("dispatches", fake?.dispatchCalls, 0);
  } else if (row.editor === "dropDispatch") refused("editor did not apply");
  else if (row.editor === "throwAfterDispatch" || row.editor === "throwAfterDispatchSerializerThrows") {
    const store = row.editor === "throwAfterDispatch" ? "SER:" + next : next;
    eq("store", o.snaps[T], { content: store, isModified: true });
    const error = "D58 simulated plugin view-update failure";
    eq("table logs", o.tableLogs, [failLog(act, { documentId: T, reason: THREW, error, storeReconciled: true })]);
  } else {
    applied(next);
    eq("dispatches", fake?.dispatchCalls, 1);
    eq("store at dispatch", fake?.storeAtDispatch[0]?.content, base);
    eq("view text", fake?.viewText(), next);
  }
  return out;
}
