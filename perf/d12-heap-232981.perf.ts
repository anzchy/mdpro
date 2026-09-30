/**
 * D12 WI-7: one size per file, so the forks pool gives it a fresh process
 * (ADR-0022 method). Non-gating; see `perf/d12Heap.ts`.
 */
import { test } from "vitest";

import { measure, report } from "./d12Heap";

test("D12 retained heap at 232981 rows (bytes, no assertion)", async () => {
  report(await measure(232981));
});
