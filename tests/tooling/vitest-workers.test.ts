// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveMaxWorkers } from "../../vitest.workers";

describe("D147 — vitest worker count", () => {
  it("W-1: an unlocked run with no override takes 2 workers", () => {
    expect(resolveMaxWorkers({})).toBe(2);
  });

  it("W-2: a run under heavy-lock with no override keeps 50%", () => {
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "1" })).toBe("50%");
  });

  it("W-3: a lock flag other than \"1\" counts as unlocked", () => {
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "0" })).toBe(2);
    expect(resolveMaxWorkers({ MDPRO_HEAVY_LOCK_HELD: "" })).toBe(2);
  });

  it("W-4: an explicit VITEST_MAX_WORKERS wins in both cases", () => {
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: "4" })).toBe(4);
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: "25%", MDPRO_HEAVY_LOCK_HELD: "1" })).toBe("25%");
    expect(resolveMaxWorkers({ VITEST_MAX_WORKERS: "6", MDPRO_HEAVY_LOCK_HELD: "1" })).toBe(6);
  });
});
