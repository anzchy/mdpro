/**
 * @module tests/support/tableOverflowArb
 * Purpose: D44 generators and oracles for overflow widening on format.
 * Shared by `tests/table-format-overflow-law.test.ts` and the log suite.
 * WI-3 measured every law case under 0.4 s with coverage, so none of them
 * moves to a `*.slow.test.ts` sibling (ADR-0050).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261007-155353.md` F-LAW-EXHAUSTIVE,
 * F-LAW-PROPERTY, F-LAW-NONVACUOUS, F-PREFIX-METAMORPHIC.
 *
 * The oracle for a row is `splitCellTexts(line).map(trim)` over the SOURCE
 * line the generator rendered, so it is independent of `model.rows` (which
 * truncates). For the canonical and tight forms the law check also
 * compares that oracle with the generator's intended cells, so a
 * `splitCellTexts` that mishandles `c\\|` cannot certify itself.
 *
 * Re-parsing goes through `findAllTables`, not `parseTableAt(src,
 * BEFORE.length)`: `lineIndexAt` resolves an offset equal to the previous
 * line's `end + 1` to that previous line (a documented, load-bearing quirk
 * in `lines.ts`), so `parseTableAt` at a table's first byte after a blank
 * line returns null.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { splitCellTexts } from "../../src/utils/tableParser/lines";
import type { ColumnAlignment, TableModel } from "../../src/utils/tableParser";
import { findAllTables } from "../../src/utils/cursorSync/table";
import { mulberry32 } from "./tableCorpus";
import { frozenFormatAllTables } from "./frozenTableFormat";

export const D44_SEED = 0x0d44_5eed;
export const BEFORE = "Before.\n\n";
export const AFTER = "\nAfter.\n";
export const EXHAUSTIVE_DOMAIN_SIZE = 1688;

export type RowForm = "canonical" | "noTrailing" | "tight" | "noEdge";
export const ROW_FORMS: readonly RowForm[] = ["canonical", "noTrailing", "tight", "noEdge"];
export const ALIGNMENTS: readonly ColumnAlignment[] = [null, "left", "right", "center"];

const EXHAUSTIVE_ALPHABET = ["", "x", "a\\|b", "c\\\\"] as const;
const RANDOM_ALPHABET = ["", "x", "yy", "中", "a\\|b", "c\\\\"] as const;
const HEADER_ALPHABET = ["h", "x"] as const;

export interface OverflowRow {
  cells: string[];
  form: RowForm;
  line: string;
}

export interface OverflowCase {
  index: number;
  source: string;
  h: number;
  aligns: ColumnAlignment[];
  header: string[];
  rows: OverflowRow[];
}

export function renderRow(cells: readonly string[], form: RowForm): string {
  switch (form) {
    case "canonical":
      return "| " + cells.join(" | ") + " |";
    case "noTrailing":
      return "| " + cells.join(" | ");
    case "tight":
      return "|" + cells.join("|") + "|";
    case "noEdge":
      return cells.join(" | ");
  }
}

function spell(a: ColumnAlignment): string {
  if (a === "left") return ":-";
  if (a === "right") return "-:";
  if (a === "center") return ":-:";
  return "-";
}

function buildCase(
  index: number,
  header: string[],
  aligns: ColumnAlignment[],
  bodies: Array<{ cells: string[]; form: RowForm }>,
): OverflowCase {
  const rows = bodies.map((b) => ({ ...b, line: renderRow(b.cells, b.form) }));
  const lines = [renderRow(header, "canonical"), renderRow(aligns.map(spell), "canonical"), ...rows.map((r) => r.line)];
  const source = BEFORE + lines.join("\n") + "\n" + AFTER;
  return { index, source, h: header.length, aligns, header, rows };
}

/** Every length-`n` tuple over `alphabet`. */
function tuples(alphabet: readonly string[], n: number): string[][] {
  let out: string[][] = [[]];
  for (let i = 0; i < n; i += 1) out = out.flatMap((t) => alphabet.map((a) => [...t, a]));
  return out;
}

/**
 * F-LAW-EXHAUSTIVE: h in {1,2}, one body row of length 1..h+2 over the
 * four-letter alphabet, in each of the four forms (no-edge only when L >= 2).
 * Exactly {@link EXHAUSTIVE_DOMAIN_SIZE} cases.
 */
export function exhaustiveOverflowDomain(): OverflowCase[] {
  const out: OverflowCase[] = [];
  for (const h of [1, 2]) {
    const header = new Array<string>(h).fill("h");
    const aligns = new Array<ColumnAlignment>(h).fill(null);
    for (const form of ROW_FORMS) {
      for (let len = 1; len <= h + 2; len += 1) {
        if (form === "noEdge" && len < 2) continue;
        for (const cells of tuples(EXHAUSTIVE_ALPHABET, len)) {
          out.push(buildCase(out.length, header, aligns, [{ cells, form }]));
        }
      }
    }
  }
  return out;
}

/** F-LAW-PROPERTY: `count` seeded random cases over the plan's domain. */
export function randomOverflowCases(seed: number, count: number): OverflowCase[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const out: OverflowCase[] = [];
  for (let i = 0; i < count; i += 1) {
    const h = int(1, 4);
    const header = Array.from({ length: h }, () => pick(HEADER_ALPHABET));
    const aligns = Array.from({ length: h }, () => pick(ALIGNMENTS));
    const bodies = Array.from({ length: int(0, 4) }, () => {
      const len = Math.max(1, h + int(-3, 3));
      const cells = Array.from({ length: len }, () => pick(RANDOM_ALPHABET));
      const forms = len >= 2 ? ROW_FORMS : ROW_FORMS.filter((f) => f !== "noEdge");
      return { cells, form: pick(forms) };
    });
    out.push(buildCase(i, header, aligns, bodies));
  }
  return out;
}

/** The independent row oracle: the source line's own cells, trimmed. */
export const oracleCells = (line: string): string[] => splitCellTexts(line).map((s) => s.trim());

export function pad(cells: readonly string[], width: number): string[] {
  const out = cells.slice();
  while (out.length < width) out.push("");
  return out;
}

/** W for one case: max(header width, widest body-row oracle). */
export function widthOf(c: OverflowCase): number {
  return Math.max(c.h, ...c.rows.map((r) => oracleCells(r.line).length));
}

/** The single table of a wrapped case, or null when there is not exactly one. */
export function onlyTable(src: string): TableModel | null {
  const tables = findAllTables(src);
  return tables.length === 1 ? tables[0] : null;
}

export type LawKey = "P0" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
export type LawReport = Record<LawKey, string[]>;

/**
 * Run P1-P6 (plus P0, the domain check that the input table spans every
 * generated row) over `cases`, against `format`. Each entry names the
 * case index and source; `seed` is printed in every entry when given.
 */
export function checkOverflowLaws(
  cases: readonly OverflowCase[],
  format: (src: string) => string,
  seed?: number,
): LawReport {
  const report: LawReport = { P0: [], P1: [], P2: [], P3: [], P4: [], P5: [], P6: [] };
  const tag = (c: OverflowCase, msg: string) =>
    `${seed === undefined ? "" : `seed=${seed} `}#${c.index} ${JSON.stringify(c.source)} ${msg}`;
  for (const c of cases) {
    const input = onlyTable(c.source);
    if (!input || input.rowCount !== 1 + c.rows.length) {
      report.P0.push(tag(c, `input rowCount ${input?.rowCount}`));
      continue;
    }
    const w = widthOf(c);
    const out = format(c.source);
    const model = onlyTable(out);
    const expected = [pad(c.header, w), ...c.rows.map((r) => pad(oracleCells(r.line), w))];
    const got = model ? model.rows.map((r) => r.map((cell) => cell.text)) : null;
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      report.P1.push(tag(c, `→ ${JSON.stringify(got)}`));
    }
    for (const r of c.rows) {
      if ((r.form === "canonical" || r.form === "tight") && JSON.stringify(oracleCells(r.line)) !== JSON.stringify(r.cells)) {
        report.P1.push(tag(c, `oracle disagrees with intended cells ${JSON.stringify(r.cells)}`));
      }
    }
    const outLines = model ? model.raw.split("\n") : [];
    if (outLines.length !== 2 + c.rows.length || outLines.some((l) => splitCellTexts(l).length !== w)) {
      report.P2.push(tag(c, `W=${w} lines=${JSON.stringify(outLines)}`));
    }
    if (format(out) !== out) report.P3.push(tag(c, "not idempotent"));
    if (w === c.h && out !== frozenFormatAllTables(c.source)) report.P4.push(tag(c, "differs from pre-fix"));
    const aligns = [...c.aligns, ...new Array<ColumnAlignment>(w - c.h).fill(null)];
    if (JSON.stringify(model?.alignments) !== JSON.stringify(aligns)) {
      report.P5.push(tag(c, `alignments ${JSON.stringify(model?.alignments)}`));
    }
    if (!out.startsWith(BEFORE) || !out.endsWith(AFTER)) report.P6.push(tag(c, "wrapper changed"));
  }
  return report;
}

/**
 * F-PREFIX-METAMORPHIC: `a = f(x)` against `b = frozen(x)`, line by line.
 * Returns null when the relation holds, else a description.
 */
export function prefixRelation(x: string, a: string, b: string): string | null {
  const al = a.split("\n");
  const bl = b.split("\n");
  if (al.length !== bl.length) return `line count ${al.length} vs ${bl.length}`;
  for (let i = 0; i < al.length; i += 1) {
    if (al[i] === bl[i]) continue;
    // A CRLF table's last line keeps the `\r` that follows the span (D44 WI-2).
    const aCr = al[i].endsWith("\r");
    const aBody = aCr ? al[i].slice(0, -1) : al[i];
    const bBody = bl[i].endsWith("\r") ? bl[i].slice(0, -1) : bl[i];
    const grew =
      aCr === bl[i].endsWith("\r") &&
      aBody.startsWith(bBody) &&
      bBody.endsWith("|") &&
      splitCellTexts(aBody).length > splitCellTexts(bBody).length;
    if (!grew) return `line ${i}: ${JSON.stringify(bl[i])} → ${JSON.stringify(al[i])} in ${JSON.stringify(x)}`;
  }
  return null;
}

export function summary(list: readonly string[]): { count: number; first: string[] } {
  return { count: list.length, first: list.slice(0, 10) };
}

/** Every LawReport entry as a summary, so one `toEqual` reports all seven. */
export function summarize(report: LawReport): Record<LawKey, { count: number; first: string[] }> {
  const out = {} as Record<LawKey, { count: number; first: string[] }>;
  for (const k of Object.keys(report) as LawKey[]) out[k] = summary(report[k]);
  return out;
}
