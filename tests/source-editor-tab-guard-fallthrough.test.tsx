/**
 * D40 P6 / D41 C2-OWN-SWALLOW-GUARD — a write-guard refusal in the mounted
 * Source editor SWALLOWS Tab (state unchanged, one `ui.table.tab_swallowed`
 * log, reason `guard-refused`). Before D41 it fell through to the wrapper's
 * default indent.
 *
 * Plans: `.claude/tdd-guardian/plan-20261001-231949.md` (P6) and
 * `.claude/tdd-guardian/plan-20261002-D41.md`; matrix
 * `.claude/tdd-guardian/tests-20261002-D41.md` (C2-OWN-SWALLOW-GUARD (a)-(e)).
 * Cases (b)-(e) pin the reason precedence around the guard: delimiter-row,
 * mixed-selection and multi-table are decided without calling the guard;
 * guard-refused outranks first-cell.
 *
 * Own-module mock exception (policy-core rule 4): `tableWriteGuard` is mocked as a
 * PASSTHROUGH with forced refusals, because no real valid table fails
 * `refuseTableWrite` (module header, `src/utils/tableWriteGuard.ts`). The
 * real-guard pair is `tests/table-write-guard.test.ts` W4. Kept in its own file
 * because `vi.mock` is file-scoped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../src/utils/tableWriteGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableWriteGuard")>();
  return { ...actual, guardTableWrite: vi.fn(actual.guardTableWrite) };
});

import { loggingService } from "../src/services/loggingService";
import { guardTableWrite } from "../src/utils/tableWriteGuard";
import { D12_FIXTURES } from "./support/tableSpanOracle";
import {
  mountEditor,
  placeCursor,
  press,
  seedStores,
  select,
  teardownEditor,
} from "./support/mountSourceEditor";

const { T3, P2 } = D12_FIXTURES;
const D2 = T3 + "\n" + P2;

type LogArg = Parameters<typeof loggingService.logEventSync>[0];
let logSpy: ReturnType<typeof vi.spyOn>;

function logsOf(event: string): LogArg[] {
  return (logSpy.mock.calls as Array<[LogArg]>).map(([p]) => p).filter((p) => p.event === event);
}

function swallowContexts(): unknown[] {
  return logsOf("ui.table.tab_swallowed").map((p) => p.context);
}

beforeEach(() => {
  seedStores();
  logSpy = vi.spyOn(loggingService, "logEventSync");
});

afterEach(() => {
  teardownEditor();
  vi.mocked(guardTableWrite).mockReset();
  logSpy.mockRestore();
});

describe("D41 — table Tab write-guard refusal swallows", () => {
  it("P6 / SWALLOW-GUARD (a): a guard refusal swallows Tab and logs guard-refused", () => {
    const view = mountEditor(T3);
    placeCursor(view, 2);
    vi.mocked(guardTableWrite).mockReturnValueOnce(false);
    const out = press(view, false);
    expect({ head: out.head, doc: out.doc, ranges: out.ranges }).toEqual({
      head: 2,
      doc: T3,
      ranges: [{ anchor: 2, head: 2 }],
    });
    expect(swallowContexts()).toEqual([
      { controlId: "source.tab_nav", key: "Tab", reason: "guard-refused", ranges: [{ anchor: 2, head: 2 }] },
    ]);
    // L6 supplement only: the refusal was asked about the table at 0.
    expect(vi.mocked(guardTableWrite)).toHaveBeenCalledWith(
      expect.objectContaining({ start: 0 }),
      "source.tab_nav",
    );
  });

  it("SWALLOW-GUARD (b): delimiter-row outranks guard-refused (guard never called)", () => {
    const view = mountEditor(T3);
    placeCursor(view, 16);
    vi.mocked(guardTableWrite).mockReturnValue(false);
    const out = press(view, false);
    expect({ doc: out.doc, ranges: out.ranges }).toEqual({ doc: T3, ranges: [{ anchor: 16, head: 16 }] });
    expect(swallowContexts()).toEqual([
      { controlId: "source.tab_nav", key: "Tab", reason: "delimiter-row", ranges: [{ anchor: 16, head: 16 }] },
    ]);
    expect(vi.mocked(guardTableWrite)).toHaveBeenCalledTimes(0);
    expect(logsOf("ui.table.write_refused")).toHaveLength(0);
  });

  it("SWALLOW-GUARD (c): guard-refused outranks first-cell on Shift-Tab", () => {
    const view = mountEditor(T3);
    placeCursor(view, 2);
    vi.mocked(guardTableWrite).mockReturnValue(false);
    const out = press(view, true);
    expect({ doc: out.doc, ranges: out.ranges }).toEqual({ doc: T3, ranges: [{ anchor: 2, head: 2 }] });
    expect(swallowContexts()).toEqual([
      { controlId: "source.tab_nav", key: "Shift-Tab", reason: "guard-refused", ranges: [{ anchor: 2, head: 2 }] },
    ]);
    expect(vi.mocked(guardTableWrite)).toHaveBeenCalledTimes(1);
  });

  it("SWALLOW-GUARD (d): mixed-selection is decided before the guard", () => {
    const view = mountEditor(T3);
    select(view, [{ anchor: 2 }, { anchor: 56 }], 0);
    vi.mocked(guardTableWrite).mockReturnValue(false);
    const out = press(view, false);
    const ranges = [{ anchor: 2, head: 2 }, { anchor: 56, head: 56 }];
    expect({ doc: out.doc, ranges: out.ranges, mainIndex: out.mainIndex }).toEqual({ doc: T3, ranges, mainIndex: 0 });
    expect(swallowContexts()).toEqual([
      { controlId: "source.tab_nav", key: "Tab", reason: "mixed-selection", ranges },
    ]);
    expect(vi.mocked(guardTableWrite)).toHaveBeenCalledTimes(0);
  });

  it("SWALLOW-GUARD (e): multi-table is decided before the guard", () => {
    const view = mountEditor(D2);
    select(view, [{ anchor: 2 }, { anchor: 59 }], 0);
    vi.mocked(guardTableWrite).mockReturnValue(false);
    const out = press(view, false);
    const ranges = [{ anchor: 2, head: 2 }, { anchor: 59, head: 59 }];
    expect({ doc: out.doc, ranges: out.ranges, mainIndex: out.mainIndex }).toEqual({ doc: D2, ranges, mainIndex: 0 });
    expect(swallowContexts()).toEqual([
      { controlId: "source.tab_nav", key: "Tab", reason: "multi-table", ranges },
    ]);
    expect(vi.mocked(guardTableWrite)).toHaveBeenCalledTimes(0);
  });
});
