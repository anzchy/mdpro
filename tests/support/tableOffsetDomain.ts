/**
 * @module tests/support/tableOffsetDomain
 * Purpose: the every-offset domain shared by the D12 table suites that are
 * split across the unit and slow tiers (ADR-0050): `table-cell-at-offset` /
 * `table-cell-at-offset.slow` (CAO-1..6) and `table-locate` /
 * `table-locate.slow` (LOC-1..9). One definition, so the slow half of a split
 * file sweeps exactly the documents, adapters and offsets its unit half does.
 *
 * Contents: `ADAPTERS`, `Doc`, `corpusDocs`, `offsetsOf`, `legacyCell`, the
 * named fixture sets `CAO2_FIXTURE_DOCS` and `loc1DocsOf()`, and
 * `DOMAIN_TIMEOUT_MS`.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { linesFromText } from "../../src/plugins/codemirror/textLineSource";
import { findCell } from "../../src/utils/tableParser/find";
import { linesFromString, type TableLineSource } from "../../src/utils/tableParser/lines";
import { parseTableAtOffset } from "../../src/utils/tableParser/parse";
import type { TableCell } from "../../src/utils/tableParser/types";
import { makeCorpus, makeOverlapCorpus, OVERLAP_SEED, SEED } from "./tableCorpus";
import { D12_FIXTURES, type D12FixtureName, textOf } from "./tableSpanOracle";

const CORPUS_COUNT = 200;

/** Whole-domain sweeps; see the same constant in `table-row-cells.test.ts`. */
export const DOMAIN_TIMEOUT_MS = 120_000;

export type AdapterName = "string" | "text";

/** Both line sources the parser accepts: the string adapter and the CodeMirror `Text` one. */
export const ADAPTERS: ReadonlyArray<[AdapterName, (s: string) => TableLineSource]> = [
  ["string", (s) => linesFromString(s)],
  ["text", (s) => linesFromText(textOf(s))],
];

export interface Doc {
  id: string;
  source: string;
}

/** The seeded corpus and the overlap corpus, 200 documents each. */
export function corpusDocs(): Doc[] {
  return [
    ...makeCorpus(SEED, CORPUS_COUNT).map((d) => ({ id: `corpus#${d.index}`, source: d.source })),
    ...makeOverlapCorpus(OVERLAP_SEED, CORPUS_COUNT).map((d) => ({
      id: `overlap#${d.index}`,
      source: d.source,
    })),
  ];
}

/** Every offset in `[-1, length + 2]`. */
export function offsetsOf(source: string): number[] {
  const out: number[] = [];
  for (let o = -1; o <= source.length + 2; o += 1) out.push(o);
  return out;
}

/** The legacy answer: the whole model, then `findCell`. */
export function legacyCell(src: TableLineSource, o: number): TableCell | null {
  const m = parseTableAtOffset(src, o);
  return m ? findCell(m, o) : null;
}

/** CAO-2's named fixtures (Finding 1's NEP / M1 shapes included). */
const CAO2_FIXTURES: D12FixtureName[] = [
  "CRLF",
  "EOF",
  "CRLF_LAST_CR",
  "HEADER_ONLY",
  "ESC",
  "CJK",
  "PAD_TRUNC",
  "PIPELESS",
  "PIPELESS_CHAIN",
  "NEP",
  "NEP_CRLF",
  "NEP_EOF",
  "NEP_TAIL",
  "M1_NEP",
  "M1_PIPED",
  "M1_BLANK",
  "AFTER_TAIL",
  "INTRO_TABLE",
];

export const CAO2_FIXTURE_DOCS: Doc[] = CAO2_FIXTURES.map((id) => ({ id, source: D12_FIXTURES[id] }));

const LOC1_FIXTURES = [
  "PIPELESS",
  "PIPELESS_CHAIN",
  "PIPED_DELIM",
  "SETEXT",
  "NEP",
  "NEP_CRLF",
] as const;

let loc1Docs: Doc[] | null = null;

/** LOC-1's domain: both corpora plus the delimiter / setext / NEP fixtures. Built once. */
export function loc1DocsOf(): Doc[] {
  loc1Docs ??= [
    ...corpusDocs(),
    ...LOC1_FIXTURES.map((name) => ({ id: name, source: D12_FIXTURES[name] })),
  ];
  return loc1Docs;
}
