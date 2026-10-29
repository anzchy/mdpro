// @vitest-environment node
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMaxWorkers } from "../../vitest.workers";

// Historical examples describe this machine's ten-core budget explicitly.
beforeEach(() => { vi.spyOn(os, "availableParallelism").mockReturnValue(10); });
afterEach(() => { vi.restoreAllMocks(); });

describe("D147 — vitest worker count", () => {
  it("W-1: an unlocked run with no override takes 2 workers", () => {
    expect(resolveMaxWorkers({})).toBe(2);
  });

  it("W-2: a run under heavy-lock with no override keeps two workers", () => {
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1" })).toBe(2);
  });

  it("W-3: a lock flag other than \"1\" counts as unlocked", () => {
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "0" })).toBe(2);
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "" })).toBe(2);
  });

  it("W-4: an explicit VITEST_MAX_WORKERS wins in both cases", () => {
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: "4" })).toBe(4);
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: "25%", MDPRO_HEAVY_LOCK_HELD: "1" })).toBe(2);
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: "6", MDPRO_HEAVY_LOCK_HELD: "1" })).toBe(3);
  });
});

describe("ADR0150 — guarded worker cap", () => {
  it("clamps an explicit worker count to cores minus two under the lock", () => {
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1", VITEST_MAX_WORKERS: "100" })).toBeLessThanOrEqual(8);
  });
});

describe("ADR0151 — memory-derived cap", () => {
  it("defaults a locked run to two workers", () => {
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1" })).toBe(2);
  });
  it("permits three measured workers under the lock and clamps larger overrides", () => {
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1", VITEST_MAX_WORKERS: "3" })).toBe(3);
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1", VITEST_MAX_WORKERS: "9" })).toBe(3);
  });
  it("preserves the CPU and measured-memory ceilings across core counts and overrides", () => {
    for (const cores of [1, 2, 3, 4, 5, 10, 32]) {
      vi.mocked(os.availableParallelism).mockReturnValue(cores);
      let previous = 0;
      for (const override of ["1", "2", "3", "7", "100"]) {
        const actual = Number(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1", VITEST_MAX_WORKERS: override }));
        expect(actual).toBeGreaterThanOrEqual(previous);
        expect(actual).toBeLessThanOrEqual(Math.max(1, cores - 2));
        expect(actual).toBeLessThanOrEqual(3);
        expect(actual).toBeLessThanOrEqual(Number(override));
        previous = actual;
      }
      const defaults = Number(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1" }));
      expect(defaults).toBeGreaterThanOrEqual(1);
      expect(defaults).toBeLessThanOrEqual(Math.min(2, Math.max(1, cores - 2)));
      for (const percentage of ["25%", "100%", "200%"]) {
        const actual = Number(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1", VITEST_MAX_WORKERS: percentage }));
        expect(actual).toBeGreaterThanOrEqual(1);
        expect(actual).toBeLessThanOrEqual(Math.max(1, cores - 2));
        expect(actual).toBeLessThanOrEqual(3);
      }
    }
  });
});
