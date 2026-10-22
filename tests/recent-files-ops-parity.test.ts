/**
 * D43 WI-2 — the TS half of the Rust ↔ TS Recent Files contract.
 *
 * OP-02: `pushRecent` / `mergePending` match every shared `push` / `merge` row of
 * `tests/fixtures/recent-files-ops.json`, and the cap constant agrees. The Rust
 * half (`apply_recent_op`) reads the same file in
 * `src-tauri/src/menu_recent_merge_contract_tests.rs`.
 *
 * OP-03: the fixture still carries the boundary rows, so a parity failure cannot
 * be turned green by deleting rows.
 */
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/recent-files-ops.json";
import { MAX_RECENT_FILES, mergePending, pushRecent } from "../src/utils/recentFiles";
import { collectionCases } from "./support/collectionCases";

interface PushRow { name: string; list: string[]; path: string; expected: string[] }
interface MergeRow { name: string; stored: string[]; pendingNewestFirst: string[]; expected: string[] }
interface SeedRow {
  name: string;
  current: string[];
  stored: string[] | null;
  pendingNewestFirst: string[];
  expected: string[];
}
interface WireRow { name: string; op: Record<string, unknown> }

const push = fixture.push as PushRow[];
const merge = fixture.merge as MergeRow[];
const seed = fixture.seed as SeedRow[];
const wire = fixture.wire as WireRow[];

describe("OP-02 TS matches every shared fixture row", () => {
  it("cap constant agrees with the fixture", () => {
    expect(MAX_RECENT_FILES).toBe(10);
    expect(fixture.maxRecentFiles).toBe(MAX_RECENT_FILES);
  });

  it.each(collectionCases("tests/recent-files-ops-parity.test.ts:38", push.map((row) => [row.name, row] as const)))("push row %s", (name, row) => {
    expect(pushRecent(row.list, row.path), name).toEqual(row.expected);
  });

  it.each(collectionCases("tests/recent-files-ops-parity.test.ts:42", merge.map((row) => [row.name, row] as const)))("merge row %s", (name, row) => {
    expect(mergePending(row.stored, row.pendingNewestFirst), name).toEqual(row.expected);
  });

  it("merge rows stay inside the shared domain (pending non-empty or stored <= cap)", () => {
    for (const row of merge) {
      expect(row.pendingNewestFirst.length > 0 || row.stored.length <= MAX_RECENT_FILES, row.name).toBe(true);
    }
  });
});

describe("OP-03 the fixture carries the boundary rows", () => {
  it("push has the 9 / 10 / 11, empty-path and duplicate rows", () => {
    for (const n of [9, 10, 11]) {
      expect(push.some((r) => r.list.length === n), `push list.length ${n}`).toBe(true);
    }
    expect(push.some((r) => r.path === ""), "push empty path").toBe(true);
    expect(push.some((r) => new Set(r.list).size < r.list.length), "push duplicate list").toBe(true);
  });

  it("merge has at least 3 rows, one with pending overlapping stored", () => {
    expect(merge.length).toBeGreaterThanOrEqual(3);
    expect(
      merge.some((r) => r.pendingNewestFirst.some((p) => r.stored.includes(p))),
      "merge pending overlaps stored",
    ).toBe(true);
  });

  it("seed has the null-stored, D43 and L(11) cap rows", () => {
    expect(seed.some((r) => r.stored === null), "seed stored null").toBe(true);
    const d43 = seed.find((r) => r.name === "seed-d43");
    expect(d43, "seed-d43 row").toEqual({
      name: "seed-d43",
      current: ["/d.md", "/c.md", "/b.md", "/g1.md", "/f.md", "/e.md", "/a.md"],
      stored: null,
      pendingNewestFirst: ["/a.md"],
      expected: ["/a.md", "/d.md", "/c.md", "/b.md", "/g1.md", "/f.md", "/e.md"],
    });
    expect(
      seed.some(
        (r) =>
          r.stored?.length === 11 &&
          r.pendingNewestFirst.length === 0 &&
          r.expected.length === 10,
      ),
      "seed L(11) with no pending caps to 10",
    ).toBe(true);
  });

  it("wire has exactly the four named ops", () => {
    expect(wire.map((r) => r.name).sort()).toEqual(["record", "refresh", "seed-null", "seed-stored"]);
  });
});
