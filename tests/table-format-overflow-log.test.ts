// @vitest-environment node
/**
 * D44 WI-1: the `editor.table.format-widened` log entry and the guard order.
 *
 * Law: an entry is emitted iff a table widened, once per widened table, with
 * context exactly `{start, end, fromColCount, toColCount}` (pre-format span,
 * that table's own widths) and never cell text. A table refused by
 * `guardTableWrite` is neither read for overflow nor logged as widened.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261007-155353.md` L-WIDEN-LOG,
 * L-NO-WIDEN-NO-LOG, L-TWO-TABLES, L-LOG-IFF-WIDENED, F-GUARD-SKIP.
 *
 * Boundaries: `loggingService.logEventSync` is spied (the sink in front of
 * Tauri `log_event`). `findAllTables` gets W2's passthrough `vi.mock`, real
 * unless a case overrides it; only F-GUARD-SKIP does, because the guard's
 * refusal is unreachable through the real scanner (matrix finding 2).
 * Paired integration case: S-SAVE-LOG in `save-format-overflow.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loggingService } from "../src/services/loggingService";
import type { TableModel } from "../src/utils/tableParser";

vi.mock("../src/utils/cursorSync/table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/cursorSync/table")>();
  return { ...actual, findAllTables: vi.fn(actual.findAllTables) };
});

const { findAllTables } = await import("../src/utils/cursorSync/table");
const { formatAllTables } = await import("../src/utils/tableFormatter");
const { CONSERVE_LITERALS, MULTI_DISTINCT_EXPECTED, MULTI_DISTINCT_INPUT, REPRO_EXPECTED, REPRO_INPUT, fixture } =
  await import("./support/tableOverflowFixtures");
const { BEFORE, exhaustiveOverflowDomain, summary, widthOf } = await import("./support/tableOverflowArb");

const WIDENED = "editor.table.format-widened";
type Payload = { level: string; event: string; context?: Record<string, unknown> };

let spy: ReturnType<typeof vi.spyOn>;
const payloads = (event: string): Payload[] =>
  spy.mock.calls.map((c) => c[0] as Payload).filter((p) => p.event === event);

beforeEach(() => {
  spy = vi.spyOn(loggingService, "logEventSync").mockImplementation(() => {});
});

describe("editor.table.format-widened", () => {
  it("L-WIDEN-LOG: F-REPRO logs one entry, 2 → 3, pre-format span, no cell text", () => {
    expect(formatAllTables(REPRO_INPUT)).toBe(REPRO_EXPECTED);
    const widened = payloads(WIDENED);
    expect(widened).toHaveLength(1);
    expect(widened[0].level).toBe("info");
    expect(widened[0].context).toEqual({ start: 0, end: 40, fromColCount: 2, toColCount: 3 });
    expect(JSON.stringify(widened[0])).not.toContain("Z");
  });

  it("L-NO-WIDEN-NO-LOG: tables without overflow log nothing", () => {
    for (const f of [...CONSERVE_LITERALS, fixture("F-HEADER-ONLY"), fixture("F-BLANK-OVERFLOW (c)")]) {
      expect(formatAllTables(f.input), f.id).toBe(f.expected);
    }
    expect(payloads(WIDENED)).toHaveLength(0);
  });

  it("L-TWO-TABLES: two widened tables each log their own widths and pre-format span", () => {
    expect(formatAllTables(MULTI_DISTINCT_INPUT)).toBe(MULTI_DISTINCT_EXPECTED);
    const contexts = payloads(WIDENED)
      .map((p) => p.context as { start: number })
      .sort((x, y) => x.start - y.start);
    expect(contexts).toEqual([
      { start: 0, end: 33, fromColCount: 2, toColCount: 3 },
      { start: 41, end: 70, fromColCount: 1, toColCount: 4 },
    ]);
  });

  it("L-LOG-IFF-WIDENED: over the exhaustive domain, one entry iff W > h", () => {
    const bad: string[] = [];
    for (const c of exhaustiveOverflowDomain()) {
      spy.mockClear();
      formatAllTables(c.source);
      const w = widthOf(c);
      const widened = payloads(WIDENED);
      if (widened.length !== (w > c.h ? 1 : 0)) {
        bad.push(`#${c.index} count ${widened.length} W=${w} h=${c.h}`);
        continue;
      }
      if (widened.length === 0) continue;
      const ctx = widened[0].context ?? {};
      const ok =
        ctx.fromColCount === c.h &&
        ctx.toColCount === w &&
        ctx.start === BEFORE.length &&
        JSON.stringify(Object.keys(ctx).sort()) === JSON.stringify(["end", "fromColCount", "start", "toColCount"]) &&
        Object.values(ctx).every((v) => typeof v === "number");
      if (!ok) bad.push(`#${c.index} ${JSON.stringify(ctx)}`);
    }
    expect(summary(bad)).toEqual({ count: 0, first: [] });
  }, 60_000);
});

describe("guard order", () => {
  it("F-GUARD-SKIP: a refused model with overflow keeps its bytes and is not logged as widened", () => {
    const src = "| a |\n---\n| b | Z |\n";
    const a = { start: 2, end: 3, text: "a", row: 0, col: 0 };
    const b = { start: 12, end: 13, text: "b", row: 1, col: 0 };
    const phantom: TableModel = {
      start: 0,
      end: 19,
      rowCount: 2,
      colCount: 1,
      alignments: [null],
      raw: "| a |\n---\n| b | Z |",
      rows: [[a], [b]],
      cells: [a, b],
    };
    vi.mocked(findAllTables).mockReturnValueOnce([phantom]);
    expect(formatAllTables(src)).toBe(src);
    const refused = payloads("ui.table.write_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0].context?.reason).toBe("setext-underline");
    expect(refused[0].context?.controlId).toBe("format.all_tables");
    expect(payloads(WIDENED)).toHaveLength(0);
  });
});
