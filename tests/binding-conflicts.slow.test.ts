// @vitest-environment node
/**
 * M1A-WI-8 — exhaustive laws 1–3: the pair and single-custom ownership
 * sweeps, unassignment independence, and rewrite stability. Runs in the
 * `slow` lane (ADR-0050); the domain is shared with
 * `tests/binding-conflicts.test.ts` through `tests/support/bindingSweep.ts`.
 *
 * Mocked: nothing.
 */
import { describe, expect, it } from "vitest";
import { resolveBindings, resolveWith } from "../src/commands/bindingConflicts";
import type { Platform } from "../src/commands/commandTable.types";
import { FIELDS, PLATFORMS, POOL, TABLES, VERSIONS, boundSet, lawOneViolations, rewriteYields, singleCustomInputs } from "./support/bindingSweep";

describe("law 1: at most one owner, single-custom sweep (S4)", () => {
  it("holds on all 6 612 inputs", () => {
    const inputs = singleCustomInputs();
    expect(inputs.length).toBe(58 * 19 * 3 * 2);
    expect(POOL.length).toBe(19);
    const violations = inputs.flatMap((i) => {
      const s = resolveWith(TABLES, i.platform, i.v, i.stored);
      return lawOneViolations(i, s.resolutions, (c, k) => s.ownerOf(c, k));
    });
    expect(violations).toEqual([]);
  });
});

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

describe("law 2: unassigning never unbinds another row (S6)", () => {
  it("holds over 234 bases × 58 fields", () => {
    const bases: { p: Platform; v: number; stored: Record<string, string> }[] = [];
    for (const p of PLATFORMS) for (const v of VERSIONS) {
      bases.push({ p, v, stored: {} });
      for (const x of POOL) bases.push({ p, v, stored: { fileSave: x } }, { p, v, stored: { fileNew: x } });
    }
    expect(bases.length).toBe(234);
    const broken: string[] = [];
    for (const b of bases) {
      const before = resolveBindings(b.p, b.v, b.stored);
      for (const f of FIELDS) {
        const after = resolveBindings(b.p, b.v, { ...b.stored, [f]: "<unassigned>" });
        for (const g of FIELDS) {
          const r = before[g];
          if (g === f || r?.kind !== "bound") continue;
          if (JSON.stringify(after[g]) !== JSON.stringify(r)) broken.push(`${b.p}@${b.v} ${JSON.stringify(b.stored)} −${f}: ${g}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("law 3: the M1b rewrite is stable (S5)", () => {
  it("rewriting yields to <unassigned> keeps the bound set, leaves no yield, and is idempotent", () => {
    let yields = 0;
    const broken: string[] = [];
    for (const i of singleCustomInputs()) {
      const res = resolveBindings(i.platform, i.v, i.stored);
      const once = rewriteYields(i.stored, res);
      if (Object.keys(once).length > Object.keys(i.stored).length) yields++;
      const res1 = resolveBindings(i.platform, i.v, once);
      const twice = rewriteYields(once, res1);
      const res2 = resolveBindings(i.platform, i.v, twice);
      const leftover = Object.values(res1).some((r) => r.kind === "suppressed" && r.reason === "yieldedToCustom");
      if (JSON.stringify(boundSet(res)) !== JSON.stringify(boundSet(res1)) || leftover || JSON.stringify(res2) !== JSON.stringify(res1))
        broken.push(`${i.platform}@${i.v} ${JSON.stringify(i.stored)}`);
    }
    expect(yields).toBeGreaterThanOrEqual(50);
    expect(broken).toEqual([]);
  });
});
