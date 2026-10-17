// @vitest-environment node
/**
 * M1A-WI-8 — law 1 (at most one owner) over the pair sweep: every pair of the
 * 58 configurable fields set to the same pool value, × 19 values × 3
 * platforms × v1/v2 (matrix § M1A-WI-8 "pair sweep (slow)"). Runs in the
 * `slow` lane (ADR-0050); the domain is shared with
 * `tests/binding-conflicts.test.ts` through `tests/support/bindingSweep.ts`.
 *
 * Mocked: nothing.
 */
import { describe, expect, it } from "vitest";
import { resolveWith } from "../src/commands/bindingConflicts";
import { FIELDS, PLATFORMS, POOL, TABLES, VERSIONS, lawOneViolations } from "./support/bindingSweep";

describe("law 1: at most one owner, pair sweep (S4)", () => {
  it("holds for 1 653 field pairs × 19 values × 3 platforms × 2 versions", () => {
    const pairs: [string, string][] = [];
    for (let a = 0; a < FIELDS.length; a++) for (let b = a + 1; b < FIELDS.length; b++) pairs.push([FIELDS[a]!, FIELDS[b]!]);
    expect(pairs.length).toBe(1653);
    let calls = 0;
    const violations: string[] = [];
    for (const platform of PLATFORMS)
      for (const v of VERSIONS)
        for (const [f, g] of pairs)
          for (const value of POOL) {
            const input = { platform, v, stored: { [f]: value, [g]: value } };
            const s = resolveWith(TABLES, platform, v, input.stored);
            calls++;
            violations.push(...lawOneViolations(input, s.resolutions, (c, k) => s.ownerOf(c, k)));
          }
    expect(calls).toBe(1653 * 19 * 3 * 2);
    expect(violations.slice(0, 20)).toEqual([]);
  });
});
