/**
 * @module perf/d12Heap
 * Purpose: D12 WI-7 — the non-gating retained-heap record. Re-measures
 * ADR-0022 Context 2's "production path" column against the D12 field
 * (ADR-0043), with ADR-0022's method: a fresh process per size (one
 * `*.perf.ts` file per size, forks pool with `isolate`), `--expose-gc`,
 * three `gc()` collections before each reading, and the measured value
 * held live past the second reading.
 *
 * The field's cost is a few hundred bytes, below single-shot noise, so
 * each D12 reading holds TRANSACTIONS independent transactions from one
 * base state and divides; a control base without the field subtracts
 * the rest of the state. `--no-flush-bytecode` (in the config) is
 * required at that scale: without it V8 flushes aged bytecode during the
 * forced GCs and one window read ~-1.1 MB (-17 KB per transaction).
 *
 * Output is bytes (`heapUsed` deltas), printed with `console.info`. It
 * asserts nothing about the numbers — a run exits 0 whatever they are.
 * Run with `pnpm perf:d12`; never collected by `vitest.config.ts`.
 *
 * Document shape: ADR-0022's sweep shape, reconstructed from its table
 * (chars = 42·R + 18, cells = 4·R): a 4-column table at offset 0 whose
 * header and body rows are each 42 chars (`| a000000 | … |\n`) and whose
 * delimiter is `|---|---|---|---|\n`; R counts the header row.
 */

import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";

import {
  getActiveTableCell,
  getTableContext,
  tableDetectionExtension,
} from "../../src/plugins/codemirror/sourceTableDetection";
import { linesFromText } from "../../src/plugins/codemirror/textLineSource";
import { parseTableAtOffset } from "../../src/utils/tableParser/parse";

const GC_PASSES = 3;
/** Independent transactions held live per reading; the delta is divided by it. */
const TRANSACTIONS = 64;
const ROW_CHARS = 42;
const DELIMITER = "|---|---|---|---|\n";

/** One 42-char row; `k` < 1e6 keeps every field at 7 chars. */
function row(k: number): string {
  const n = String(k).padStart(6, "0");
  return `| a${n} | b${n} | c${n} | d${n} |\n`;
}

/** ADR-0022's shape: R rows including the header, table at offset 0. */
export function adr0022Doc(rows: number): string {
  const parts: string[] = [row(0), DELIMITER];
  for (let k = 1; k < rows; k += 1) parts.push(row(k));
  return parts.join("");
}

/** Offset of column 1's text in table row `r` (0 = header). */
function cellOffset(r: number): number {
  const lineStart = r === 0 ? 0 : ROW_CHARS + DELIMITER.length + (r - 1) * ROW_CHARS;
  return lineStart + "| a000000 | ".length + 2;
}

type GcFn = () => void;

function collect(): void {
  const gc = (globalThis as { gc?: GcFn }).gc;
  if (typeof gc !== "function") throw new Error("run with --expose-gc (pnpm perf:d12)");
  for (let i = 0; i < GC_PASSES; i += 1) gc();
}

/**
 * Retained bytes of `produce()`'s result: triple-GC baseline, produce,
 * triple-GC reading, and the result is touched after the reading so it
 * is live across it.
 */
async function retained<T>(
  produce: () => T | Promise<T>,
  keepAlive: (value: T) => unknown,
): Promise<number> {
  collect();
  const before = process.memoryUsage().heapUsed;
  const value = await produce();
  collect();
  const after = process.memoryUsage().heapUsed;
  sink.push(keepAlive(value));
  sink.push(value);
  return after - before;
}

/**
 * Yield to the event loop. 64 whole-table re-locates at 232,981 rows run
 * ~90 s; done in one synchronous block they starve vitest's worker RPC
 * ("Timeout calling onTaskUpdate") and the run exits 1.
 */
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Holds measured values until the process ends. */
const sink: unknown[] = [];

function makeState(doc: string, head: number, extensions: Extension[]): EditorState {
  return EditorState.create({ doc, selection: { anchor: head }, extensions });
}

/** Load and JIT every path once on a small table so module setup is not measured. */
function warmUp(): void {
  const doc = adr0022Doc(50);
  for (const ext of [[markdown(), tableDetectionExtension()], [markdown()]]) {
    const s = makeState(doc, cellOffset(5), ext);
    s.update({ selection: { anchor: cellOffset(40) } }).state;
    s.update({ changes: { from: cellOffset(20), insert: "x" } }).state;
  }
  parseTableAtOffset(linesFromText(makeState(doc, 0, []).doc), cellOffset(5));
}

export interface HeapRow {
  rows: number;
  chars: number;
  selWith: number;
  selWithout: number;
  docWith: number;
  docWithout: number;
  legacyProduction: number;
  legacyParseOnly: number;
  legacyCells: number;
}

/** Measure one size. Call once per process. */
export async function measure(rows: number): Promise<HeapRow> {
  warmUp();
  const doc = adr0022Doc(rows);
  if (doc.length !== ROW_CHARS * rows + DELIMITER.length) throw new Error("shape drift");
  const start = cellOffset(Math.floor(rows / 4));
  const moveTo = cellOffset(Math.floor((3 * rows) / 4));
  const editAt = cellOffset(Math.floor(rows / 2));

  // Base states, created and kept live BEFORE any baseline.
  const withField = makeState(doc, start, [markdown(), tableDetectionExtension()]);
  const control = makeState(doc, start, [markdown()]);
  if (getTableContext(withField) === null) throw new Error("base head not in table");
  sink.push(withField, control);

  // TRANSACTIONS distinct targets, each from the SAME base state, all held.
  const offsets = Array.from({ length: TRANSACTIONS }, (_, i) => i);
  const selectAt = (i: number) => ({ selection: { anchor: moveTo + (i % 3) } });
  const editAt_ = (i: number) => {
    const at = editAt + (i % 3);
    return { changes: { from: at, insert: "x" }, selection: { anchor: at + 1 } };
  };
  const fieldsOf = (states: EditorState[]) =>
    states.map((s) => [getTableContext(s), getActiveTableCell(s)]);
  const many = (base: EditorState, spec: (i: number) => object) => async () => {
    const out: EditorState[] = [];
    for (const i of offsets) {
      out.push(base.update(spec(i)).state);
      await yieldLoop();
    }
    return out;
  };
  const perTx = (n: number) => Math.round(n / TRANSACTIONS);

  // Settle: run each path once at this size outside any window, then take
  // one discarded reading. Both results are dropped.
  for (const base of [withField, control]) base.update(editAt_(0)).state;
  await retained(many(control, selectAt), fieldsOf);
  const selWith = perTx(await retained(many(withField, selectAt), fieldsOf));
  const selWithout = perTx(await retained(many(control, selectAt), fieldsOf));
  const docWith = perTx(await retained(many(withField, editAt_), fieldsOf));
  const docWithout = perTx(await retained(many(control, editAt_), fieldsOf));

  // Pre-D12 comparison: what the field used to rebuild on every move.
  const legacyProduction = await retained(
    () => parseTableAtOffset(linesFromText(withField.doc), moveTo),
    (m) => m?.cells.length,
  );
  const src = linesFromText(withField.doc);
  src.lineIndexAt(moveTo); // build any lazy line index before the baseline
  sink.push(src);
  let legacyCells = 0;
  const legacyParseOnly = await retained(
    () => parseTableAtOffset(src, moveTo),
    (m) => (legacyCells = m?.cells.length ?? 0),
  );

  return {
    rows, chars: doc.length, selWith, selWithout, docWith, docWithout,
    legacyProduction, legacyParseOnly, legacyCells,
  };
}

const fmt = (n: number): string => n.toLocaleString("en-US");

/** Print one size as a small table (bytes). */
export function report(r: HeapRow): void {
  const lines = [
    `D12 WI-7 retained heap — ${fmt(r.rows)} rows, ${fmt(r.chars)} chars, pid ${process.pid}`,
    `bytes per transaction = heapUsed delta / ${TRANSACTIONS} held transactions; PRE-D12 rows are one call`,
    `| path | with field (B) | control, no field (B) | field = with − control (B) |`,
    `|---|---|---|---|`,
    `| selection-only move (reuse) | ${fmt(r.selWith)} | ${fmt(r.selWithout)} | ${fmt(r.selWith - r.selWithout)} |`,
    `| docChanged, 1 char (re-locate) | ${fmt(r.docWith)} | ${fmt(r.docWithout)} | ${fmt(r.docWith - r.docWithout)} |`,
    `| PRE-D12 linesFromText + parseTableAtOffset | ${fmt(r.legacyProduction)} | — | — |`,
    `| PRE-D12 parseTableAtOffset only (${fmt(r.legacyCells)} cells) | ${fmt(r.legacyParseOnly)} | — | — |`,
  ];
  console.info(lines.join("\n"));
}
