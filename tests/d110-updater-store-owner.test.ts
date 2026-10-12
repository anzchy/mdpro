// @vitest-environment node
/**
 * D110-WI-1 (store half): the update-check cache is owned by a request.
 *
 * Law: a cache write (set or clear) carrying a request id applies iff no newer
 * request has begun since that id was issued. Equivalently: once request N+1
 * has begun, nothing request N does can change the cache. O1 checks the law
 * against an independent oracle over every interleaving of three requests.
 * A write without an id stays unconditional (the pre-D110 API, updaterStore.test.ts).
 *
 * Mock boundary: none — the real Zustand store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useUpdaterStore } from "../src/stores/updaterStore";
import type { CacheSafeState } from "../src/stores/updaterStore";

const UP: CacheSafeState = { phase: "up-to-date" };
const ERR: CacheSafeState = { phase: "error", message: "boom" };
const OFF: CacheSafeState = { phase: "updates-disabled" };

/** Begin a request through the store's API, asserting the API exists. */
function begin(): number {
  const { beginRequest } = useUpdaterStore.getState() as { beginRequest?: () => number };
  expect(typeof beginRequest).toBe("function");
  return beginRequest!();
}

beforeEach(() => {
  useUpdaterStore.setState({ cachedResult: null });
});

describe("updaterStore — request ownership (D110)", () => {
  it("S1: beginRequest issues strictly increasing ids", () => {
    const ids = [begin(), begin(), begin()];
    expect(ids[1]).toBeGreaterThan(ids[0]);
    expect(ids[2]).toBeGreaterThan(ids[1]);
  });

  it("S2: the current request's write applies and reports true", () => {
    const id = begin();
    expect(useUpdaterStore.getState().setCachedResult(UP, id)).toBe(true);
    expect(useUpdaterStore.getState().cachedResult).toEqual(UP);
  });

  it("S3: a superseded request's write is dropped and reports false", () => {
    const a = begin();
    const b = begin();
    expect(useUpdaterStore.getState().setCachedResult(UP, b)).toBe(true);
    expect(useUpdaterStore.getState().setCachedResult(ERR, a)).toBe(false);
    expect(useUpdaterStore.getState().cachedResult).toEqual(UP);
  });

  it("S4: a superseded request cannot clear a newer request's cache", () => {
    const a = begin();
    const b = begin();
    useUpdaterStore.getState().setCachedResult(OFF, b);
    expect(useUpdaterStore.getState().clearCache(a)).toBe(false);
    expect(useUpdaterStore.getState().cachedResult).toEqual(OFF);
  });

  it("S5: the current request may clear the cache", () => {
    useUpdaterStore.setState({ cachedResult: ERR });
    const id = begin();
    expect(useUpdaterStore.getState().clearCache(id)).toBe(true);
    expect(useUpdaterStore.getState().cachedResult).toBeNull();
  });

  it("S6: a superseded write is dropped even when the newer request never writes", () => {
    useUpdaterStore.setState({ cachedResult: ERR });
    const a = begin();
    begin();
    expect(useUpdaterStore.getState().setCachedResult(UP, a)).toBe(false);
    expect(useUpdaterStore.getState().clearCache(a)).toBe(false);
    expect(useUpdaterStore.getState().cachedResult).toEqual(ERR);
  });

  it("O1: every interleaving of three requests agrees with the ownership oracle", () => {
    type Step = { kind: "begin" | "write"; req: number };
    // Each request writes something different; request 1 clears.
    const writes: (CacheSafeState | null)[] = [UP, null, ERR];

    // All orderings of 6 steps where each request's begin precedes its write.
    function interleavings(): Step[][] {
      const out: Step[][] = [];
      const walk = (seq: Step[], begun: boolean[], written: boolean[]) => {
        if (seq.length === 6) return void out.push(seq);
        for (let r = 0; r < 3; r++) {
          if (!begun[r]) {
            const b = [...begun]; b[r] = true;
            walk([...seq, { kind: "begin", req: r }], b, written);
          } else if (!written[r]) {
            const w = [...written]; w[r] = true;
            walk([...seq, { kind: "write", req: r }], begun, w);
          }
        }
      };
      walk([], [false, false, false], [false, false, false]);
      return out;
    }

    const all = interleavings();
    expect(all).toHaveLength(90);

    const mismatches: string[] = [];
    for (const seq of all) {
      useUpdaterStore.setState({ cachedResult: OFF });
      const ids: number[] = [];
      // Oracle: track begin order independently of the store.
      let oracle: CacheSafeState | null = OFF;
      let lastBegun = -1;
      const beginOrder: number[] = [];
      for (const step of seq) {
        if (step.kind === "begin") {
          ids[step.req] = begin();
          beginOrder.push(step.req);
          lastBegun = step.req;
        } else {
          const w = writes[step.req];
          const { setCachedResult, clearCache } = useUpdaterStore.getState();
          if (w === null) clearCache(ids[step.req]);
          else setCachedResult(w, ids[step.req]);
          if (lastBegun === step.req) oracle = w;
        }
      }
      const got = useUpdaterStore.getState().cachedResult;
      if (JSON.stringify(got) !== JSON.stringify(oracle)) {
        mismatches.push(`${seq.map((s) => `${s.kind[0]}${s.req}`).join(" ")} → ${JSON.stringify(got)} ≠ ${JSON.stringify(oracle)}`);
      }
      expect(beginOrder).toHaveLength(3);
    }
    expect(mismatches).toEqual([]);
  });
});
