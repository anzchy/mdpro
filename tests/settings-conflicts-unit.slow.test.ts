// @vitest-environment node
/** Exhaustive M1A-WI-10 conflict relation sweep; the domain is shared with the unit sibling (ADR-0050). */
import { describe, expect, it } from "vitest";
import type { Platform } from "../src/commands/commandTable.types";
import { findSettingsConflicts } from "../src/commands/settingsConflicts";
import { FIELDS, POOL } from "./support/bindingSweep";
import { HIDDEN, PLATFORMS, expected, keysOf, v2Defaults } from "./support/settingsConflictDomain";

describe("M1A-WI-10 law: refused iff a conflict involves a custom value (S4; M7: every side is shown)", () => {
  const SWEEP_POOL = [...POOL, "Cmd+Shift+E"];

  it("holds over 58 fields × 20 values × 3 platforms × v1/v2, plus every hidden pair on Cmd+J", () => {
    expect(SWEEP_POOL).toHaveLength(20);
    const partitions = new Map<string, number>();
    const bump = (k: string) => partitions.set(k, (partitions.get(k) ?? 0) + 1);
    let n = 0;
    const check = (p: Platform, v: number, local: Record<string, string>) => {
      n += 1;
      const want = expected(p, v, local);
      const got = findSettingsConflicts(p, v, local);
      const label = `${p}@${v} ${JSON.stringify(local)}`;
      expect(keysOf(got), label).toEqual(want.refusing);
      for (const k of want.via) bump(k);
      if (want.refusing.length === 0) bump("empty");
    };
    for (const p of PLATFORMS)
      for (const v of [1, 2]) {
        const base = v === 2 ? v2Defaults(p) : {};
        for (const field of FIELDS) for (const value of SWEEP_POOL) check(p, v, { ...base, [field]: value });
        for (let i = 0; i < HIDDEN.length; i += 1)
          for (let j = i + 1; j < HIDDEN.length; j += 1)
            check(p, v, { ...base, [HIDDEN[i] as string]: "Cmd+J", [HIDDEN[j] as string]: "Cmd+J" });
      }
    expect(n).toBe(6960 + 216);
    for (const k of ["refused-flag", "refused-yield", "refused-formerly-hidden", "refused-formerly-hidden-only", "empty"])
      expect(partitions.get(k) ?? 0, k).toBeGreaterThan(0);
  });
});
