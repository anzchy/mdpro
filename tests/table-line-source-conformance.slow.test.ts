// @vitest-environment node
/**
 * @module table-line-source-conformance.slow.test
 * Slow tier (ADR-0050) of `table-line-source-conformance.test.ts` (WI-3B):
 * `captureCellFromLines` / `locateCellInLines` over the CodeMirror `Text`
 * adapter must agree with their string twins at every offset and every cell
 * of the 200-document corpus. The capture side runs a full scan per offset,
 * about 5.2 s under coverage, so it runs in `pnpm test:slow`. Same law and
 * corpus as the unit file; real `Text`, no mocks.
 */

import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";

import { linesFromText } from "../src/plugins/codemirror/textLineSource";
import {
  captureCellFromLines,
  captureCellFromSource,
  findAllTables,
  locateCellInLines,
  locateCellInSource,
} from "../src/utils/cursorSync/table";
import { makeCorpus, SEED, type CorpusDoc } from "./support/tableCorpus";

const CORPUS: CorpusDoc[] = makeCorpus(SEED, 200);

/** `Text.of` needs a non-empty array; `"".split("\n")` is `[""]`. */
function textOf(src: string): Text {
  return Text.of(src.split("\n"));
}

/** Compact structural comparison, as in the unit file. */
const shape = (value: unknown): string => JSON.stringify(value ?? null);

describe("CONF-differential (slow tier)", () => {
  it("captureCellFromLines / locateCellInLines agree with their string twins", () => {
    const problems: string[] = [];
    for (const doc of CORPUS) {
      const text = textOf(doc.source);
      const src = text.toString();
      for (let o = 0; o <= src.length; o += 1) {
        const a = shape(captureCellFromSource(src, o));
        const b = shape(captureCellFromLines(linesFromText(text), o));
        if (a !== b) problems.push(`doc ${doc.index} capture(${o}): ${a} vs ${b}`);
      }
      const tables = findAllTables(src);
      for (let t = 0; t < tables.length; t += 1) {
        for (let r = 0; r < tables[t].rowCount; r += 1) {
          for (let c = 0; c < tables[t].colCount; c += 1) {
            const pos = { tableIndex: t, rowIndex: r, colIndex: c };
            const a = shape(locateCellInSource(src, pos));
            const b = shape(locateCellInLines(linesFromText(text), pos));
            if (a !== b) problems.push(`doc ${doc.index} locate(${t},${r},${c})`);
          }
        }
      }
      if (problems.length > 10) break;
    }
    expect(problems).toEqual([]);
  });
});
