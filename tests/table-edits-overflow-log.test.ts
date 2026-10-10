// @vitest-environment node
/**
 * D49 WI-1.3: one `editor.table.edit-widened` log entry per context-menu
 * edit whose table widened (rule 20).
 *
 * Law: `applyEdit` emits an entry iff the edit rewrote a table whose widest
 * row is wider than its header (W > h), exactly once per call, with context
 * exactly `{action, fromColCount: h, toColCount: W}` where W is the widened
 * width BEFORE the edit's own column insert/delete. It never carries cell
 * text. `EditResult.widened` carries the same counts (single-pass mechanism).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-1.3" LG-1 to
 * LG-7, with adversary-round-1 amendment 2 (LG-1 also pins `widened`).
 * LG-2 and LG-3 are pins. LG-INT (the real Tauri boundary) lives in
 * `tests/source-table-context-menu-widen-log.test.ts`.
 *
 * Boundary: `loggingService.logEventSync` is spied (the sink in front of
 * Tauri `log_event`), the pattern `table-format-overflow-log.test.ts` uses.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import { applyEdit } from "../src/utils/tableEdits";
import { isActionDisabled } from "../src/plugins/milkdown/table/actionGate";
import { parseTableAt, type TableModel } from "../src/utils/tableParser";
import type { TableActionId } from "../src/plugins/milkdown/table/types";
import { ALL_ACTION_IDS, ctxAt } from "./support/tableEditsOverflowLaws";
import {
  D44_SEED,
  exhaustiveOverflowDomain,
  oracleCells,
  onlyTable,
  randomOverflowCases,
  summary,
  widthOf,
} from "./support/tableOverflowArb";

const WIDENED = "editor.table.edit-widened";
const T2 = "| a | b |\n|---|---|\n| 1 | 2 | Z |\n| 3 | 4 |\n";
const E11 = [
  "| a   | b   |     |",
  "| --- | --- | --- |",
  "| 1   | 2   | Z   |",
  "| 3   | 4   |     |",
].join("\n");
const LG4_CASES = 200;
const LG4_MIN_ENTRIES = 100;
const CONTEXT_KEYS = ["action", "fromColCount", "toColCount"];

type Payload = { level: string; event: string; status?: string; actionId?: string; context?: Record<string, unknown> };

let spy: ReturnType<typeof vi.spyOn>;
const widened = (): Payload[] =>
  spy.mock.calls.map((c) => c[0] as Payload).filter((p) => p.event === WIDENED);

function model(src: string): TableModel {
  const m = parseTableAt(src, 0);
  if (!m) throw new Error(`no table in ${JSON.stringify(src)}`);
  return m;
}

beforeEach(() => {
  spy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

describe("LG-1: a widened reformat logs once and reports the widening", () => {
  it("reformat_table on T2 keeps Z, logs 2 → 3, and returns widened", () => {
    const m = model(T2);
    const out = applyEdit(m, ctxAt(m, 1, 0), "reformat_table");
    expect(out?.source).toBe(E11);
    expect(out!.widened).toEqual({ fromColCount: 2, toColCount: 3 });
    const entries = widened();
    expect(entries).toHaveLength(1);
    const { actionId: _ignored, ...entry } = entries[0];
    void _ignored;
    expect(entry).toEqual({
      level: "info",
      event: WIDENED,
      status: "success",
      context: { action: "reformat_table", fromColCount: 2, toColCount: 3 },
    });
  });
});

describe("LG-2 (pin): a table with no overflow never logs", () => {
  it("all 15 actions run and none logs widened", () => {
    const m = model("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n");
    for (const id of ALL_ACTION_IDS) {
      const out = applyEdit(m, ctxAt(m, 1, 1), id);
      expect(out, id).not.toBeNull();
      expect(out!.widened, id).toBeUndefined();
    }
    expect(widened()).toHaveLength(0);
  });
});

describe("LG-3 (pin): delete_table and disabled actions never log", () => {
  it("delete_table empties the table; disabled moves return null; nothing logs", () => {
    const m = model(T2);
    expect(applyEdit(m, ctxAt(m, 1, 0), "delete_table")).toEqual({ source: "", cursorOffset: 0 });
    expect(applyEdit(m, ctxAt(m, 0, 0), "move_row_up")).toBeNull();
    expect(applyEdit(m, ctxAt(m, 1, 1), "move_column_right")).toBeNull();
    expect(widened()).toHaveLength(0);
  });
});

describe("LG-4: entries never carry cell text", () => {
  it("over seeded random cases, contexts are exactly the three counts", () => {
    const ids = new Set<string>(ALL_ACTION_IDS);
    const bad: string[] = [];
    let inspected = 0;
    for (const c of randomOverflowCases(D44_SEED, LG4_CASES)) {
      const m = onlyTable(c.source);
      if (!m) continue;
      const texts = [...c.header, ...c.rows.flatMap((r) => oracleCells(r.line))].filter((t) => t.length > 1);
      for (let r = 0; r < m.rowCount; r += 1) {
        for (let col = 0; col < m.colCount; col += 1) {
          for (const id of ALL_ACTION_IDS) {
            spy.mockClear();
            applyEdit(m, ctxAt(m, r, col), id);
            for (const e of widened()) {
              inspected += 1;
              const ctx = e.context ?? {};
              const json = JSON.stringify(ctx);
              const ok =
                JSON.stringify(Object.keys(ctx).sort()) === JSON.stringify(CONTEXT_KEYS) &&
                ids.has(String(ctx.action)) &&
                Number.isInteger(ctx.fromColCount) &&
                Number.isInteger(ctx.toColCount) &&
                texts.every((t) => !json.includes(t));
              if (!ok) bad.push(`#${c.index} ${id} (${r},${col}) ${json}`);
            }
          }
        }
      }
    }
    expect(summary(bad)).toEqual({ count: 0, first: [] });
    expect(inspected).toBeGreaterThanOrEqual(LG4_MIN_ENTRIES);
  });
});

describe("LG-5: toColCount is the widened width before the edit's own mutation", () => {
  it.each<[TableActionId, number, number]>([
    ["insert_column_after", 1, 1],
    ["delete_column", 1, 0],
    ["delete_row", 1, 0],
  ])("%s at (%i,%i) logs 2 → 3", (id, r, c) => {
    const m = model(T2);
    const out = applyEdit(m, ctxAt(m, r, c), id);
    expect(out).not.toBeNull();
    expect(out!.widened).toEqual({ fromColCount: 2, toColCount: 3 });
    expect(widened().map((e) => e.context)).toEqual([{ action: id, fromColCount: 2, toColCount: 3 }]);
  });
});

describe("LG-6: over the exhaustive domain, one entry iff W > h", () => {
  it("every enabled rewriting call logs (W > h ? 1 : 0) entries with h and W", () => {
    const bad: string[] = [];
    let logged = 0;
    for (const c of exhaustiveOverflowDomain()) {
      const m = onlyTable(c.source);
      if (!m) {
        bad.push(`#${c.index} no table`);
        continue;
      }
      const w = widthOf(c);
      for (let r = 0; r < m.rowCount; r += 1) {
        for (let col = 0; col < m.colCount; col += 1) {
          const ctx = ctxAt(m, r, col);
          for (const id of ALL_ACTION_IDS) {
            if (id === "delete_table" || isActionDisabled(id, ctx)) continue;
            spy.mockClear();
            applyEdit(m, ctx, id);
            const entries = widened();
            if (entries.length !== (w > c.h ? 1 : 0)) {
              bad.push(`#${c.index} ${id} count ${entries.length} W=${w} h=${c.h}`);
              continue;
            }
            if (entries.length === 0) continue;
            logged += 1;
            const e = entries[0].context ?? {};
            if (e.action !== id || e.fromColCount !== c.h || e.toColCount !== w) {
              bad.push(`#${c.index} ${id} ${JSON.stringify(e)} W=${w} h=${c.h}`);
            }
          }
        }
      }
    }
    expect(summary(bad)).toEqual({ count: 0, first: [] });
    expect(logged).toBeGreaterThan(0);
  });
});

describe("LG-7: several overflow rows still log once, at the widest width", () => {
  it("reformat logs exactly one entry with toColCount 4", () => {
    const m = model("| a | b |\n|---|---|\n| 1 | 2 | P |\n| 3 | 4 | Q | R |\n");
    const out = applyEdit(m, ctxAt(m, 1, 0), "reformat_table");
    expect(out?.source).toContain("R");
    expect(widened().map((e) => e.context)).toEqual([
      { action: "reformat_table", fromColCount: 2, toColCount: 4 },
    ]);
  });
});
