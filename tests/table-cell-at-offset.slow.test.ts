// @vitest-environment node
/**
 * @module table-cell-at-offset.slow.test
 * Slow tier (ADR-0050) of `table-cell-at-offset.test.ts`: the CAO-6 wrapper
 * identity law swept over the whole CAO-1 domain (both corpora, every offset,
 * both adapters) plus the CAO-2 fixtures and NaN. About 5.5 s under coverage,
 * so it runs in `pnpm test:slow`, not on every commit. The unit file keeps the
 * fixture-level CAO-6 cases; both halves share `support/tableOffsetDomain`.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` case CAO-6.
 */

import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import {
  cellAtOffset,
  cellAtResolvedLine,
  locateTableAtOffset,
} from "../src/utils/tableParser/locate";
import {
  ADAPTERS,
  CAO2_FIXTURE_DOCS as FIXTURE_DOCS,
  corpusDocs,
  DOMAIN_TIMEOUT_MS,
  legacyCell,
  offsetsOf,
} from "./support/tableOffsetDomain";
import { recordingSource } from "./support/tableSpanOracle";

describe("CAO-6 wrapper identity: cellAtOffset = cellAtResolvedLine after lineIndexAt (K = 3)", () => {
  it("agrees in value and in recorded calls over the CAO-1 domain, the CAO-2 fixtures and NaN", () => {
    const mismatches: string[] = [];
    for (const { id, source } of [...corpusDocs(), ...FIXTURE_DOCS]) {
      for (const [name, make] of ADAPTERS) {
        for (const o of [...offsetsOf(source), Number.NaN]) {
          const span = locateTableAtOffset(make(source), o);
          const srcH = recordingSource(make(source));
          const srcW = recordingSource(make(source));
          const h = cellAtResolvedLine(srcH, span, srcH.lineIndexAt(o), o);
          const w = cellAtOffset(srcW, span, o);
          const expected = legacyCell(make(source), o);
          const where = `${id}/${name}@${o}`;
          if (!isDeepStrictEqual(h, w)) mismatches.push(`${where}: helper ${JSON.stringify(h)} wrapper ${JSON.stringify(w)}`);
          if (!isDeepStrictEqual(w, expected)) mismatches.push(`${where}: wrapper ${JSON.stringify(w)} legacy ${JSON.stringify(expected)}`);
          if (srcH.lineIndexAtCalls !== srcW.lineIndexAtCalls) {
            mismatches.push(`${where}: lineIndexAt helper ${srcH.lineIndexAtCalls} wrapper ${srcW.lineIndexAtCalls}`);
          }
          if (!isDeepStrictEqual(srcH.lineIndices, srcW.lineIndices)) {
            mismatches.push(`${where}: line seq helper [${srcH.lineIndices}] wrapper [${srcW.lineIndices}]`);
          }
        }
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches.length).toBe(0);
  }, DOMAIN_TIMEOUT_MS);
});
