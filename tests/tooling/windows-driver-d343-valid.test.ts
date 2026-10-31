// @vitest-environment node
import { describe, expect, it } from "vitest";
import { check, probe, rawRow } from "./windows-driver-d343-harness";
export const smoke = ['[{"op":"max"}]', '[{"op":"windows"}]', '[{"op":"max"},{"op":"wait","ms":500},{"op":"windows"}]'];
describe("D343 valid native step lists", () => {
  it("reproduces 5.1 emission without losing empty, null or nested slots", async () => {
    const results = await probe();
    expect(results.map((r) => [r.emitted, r.count, r.array, r.custom, r.firstNull, r.nested])).toEqual([
      [1, 0, true, false, false, false], [1, 1, true, false, false, false],
      [1, 2, true, false, false, false], [1, 1, true, false, true, false], [1, 1, true, false, false, true],
    ]);
  });
  it("accepts every smoke list with exact original bytes under both shapes", async () => {
    await check([...smoke, '[\r\n {"op": "max"}, {"op":"wait", "ms":500}, {"op":"windows"}\r\n]'].map((raw, i) => rawRow(String(i), raw)));
  });
});
