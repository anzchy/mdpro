// @vitest-environment node
/**
 * @module table-locate.slow.test
 * Slow tier (ADR-0050) of `table-locate.test.ts`: LOC-2, the identical-walk
 * law. `locateTableAtOffset` and `parseTableAtOffset` must make the same
 * `line()` index sequence and `lineIndexAt` count at every offset of LOC-1's
 * domain (both corpora plus the delimiter / setext / NEP fixtures, both
 * adapters). About 4.9 s under coverage, so it runs in `pnpm test:slow`. The
 * domain comes from `support/tableOffsetDomain`, shared with the unit file.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260930-D12.md` case LOC-2.
 */

import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import { locateTableAtOffset } from "../src/utils/tableParser/locate";
import { parseTableAtOffset } from "../src/utils/tableParser/parse";
import { ADAPTERS, DOMAIN_TIMEOUT_MS, loc1DocsOf, offsetsOf } from "./support/tableOffsetDomain";
import { recordingSource } from "./support/tableSpanOracle";

describe("LOC-2 locate and parse make identical line() index sequences", () => {
  it("records the same line() sequence and lineIndexAt count at every offset", () => {
    const mismatches: string[] = [];
    for (const { id, source } of loc1DocsOf()) {
      for (const [name, make] of ADAPTERS) {
        for (const o of offsetsOf(source)) {
          const recA = recordingSource(make(source));
          const recB = recordingSource(make(source));
          parseTableAtOffset(recA, o);
          locateTableAtOffset(recB, o);
          if (
            !isDeepStrictEqual(recB.lineIndices, recA.lineIndices) ||
            recB.lineIndexAtCalls !== recA.lineIndexAtCalls
          ) {
            mismatches.push(
              `${id}/${name}@${o}: locate [${recB.lineIndices}] x${recB.lineIndexAtCalls} ` +
                `parse [${recA.lineIndices}] x${recA.lineIndexAtCalls}`,
            );
          }
        }
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(mismatches.length).toBe(0);
  }, DOMAIN_TIMEOUT_MS);
});
