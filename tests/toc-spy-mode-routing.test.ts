/**
 * WI-3 — `src/utils/tocSpyMode.ts#resolveSpyMode`.
 *
 * Matrix §4 of `.claude/tdd-guardian/tests-20260919-151931.md`, cases M-1 … M-4.
 *
 * CASE ORDER IN THIS FILE IS LOAD-BEARING. `resolveSpyMode`'s one-shot warn is a
 * module-scope `let warned = false`. `vitest.config.ts` sets `clearMocks`/`restoreMocks`,
 * which reset *mock* state and never module state, and §0.3/§0 forbid `vi.resetModules()`.
 * M-4 is therefore the ONLY case in this file that may evaluate an out-of-union value:
 * M-1/M-2/M-3 stay inside the declared `{true,false} × {"wysiwyg","source",undefined}`
 * domain so they cannot consume the one-shot before M-4 declares. Do not widen them, and
 * do not insert a new out-of-union case above M-4.
 */
import { describe, expect, it, vi } from "vitest";

// §0.12 logging double — the established shape (tests/toc-wholesale-reset.test.ts:65-72).
const logEventSyncMock = vi.fn();
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: (...args: unknown[]) => logEventSyncMock(...args),
    logEvent: async () => undefined,
    generateActionId: () => "test-action-id",
  },
}));

import type { ViewMode } from "../src/types/editor";
import type { LogEntryPayload } from "../src/types/logging";
import type { TocSpyMode } from "../src/utils/tocSpyMode";
import { resolveSpyMode } from "../src/utils/tocSpyMode";

const UNKNOWN_MODE_EVENT = "ui.toc.spy.mode.unknown";

const ALL_SPY_MODES: readonly TocSpyMode[] = ["dom", "line", "off"];

interface TruthRow {
  readonly label: string;
  readonly enabled: boolean;
  readonly viewMode: ViewMode | undefined;
  readonly expected: TocSpyMode;
}

/**
 * The complete declared input domain: `{true,false} × {"wysiwyg","source",undefined}`.
 * Six cells, written as a table rather than six `it()`s (M-1).
 */
const TRUTH_TABLE: readonly TruthRow[] = [
  { label: '(true, "wysiwyg")', enabled: true, viewMode: "wysiwyg", expected: "dom" },
  { label: '(true, "source")', enabled: true, viewMode: "source", expected: "line" },
  { label: "(true, undefined)", enabled: true, viewMode: undefined, expected: "dom" },
  { label: '(false, "wysiwyg")', enabled: false, viewMode: "wysiwyg", expected: "off" },
  { label: '(false, "source")', enabled: false, viewMode: "source", expected: "off" },
  { label: "(false, undefined)", enabled: false, viewMode: undefined, expected: "off" },
];

function unknownModeWarnCalls(): LogEntryPayload[] {
  return logEventSyncMock.mock.calls
    .map((call) => call[0] as LogEntryPayload)
    .filter((payload) => payload?.event === UNKNOWN_MODE_EVENT);
}

describe("resolveSpyMode — spy-mode routing (WI-3)", () => {
  it("M-1/M-3: routes the full declared truth table, and the unions are complete", () => {
    // M-3 (Level 6, compile-time supplement): a fourth TocSpyMode or a third ViewMode
    // breaks these records under `pnpm typecheck:tests`, and the runtime assertions
    // below make the case fail visibly under `pnpm test:run` too.
    const ALL_MODES: Record<TocSpyMode, true> = { dom: true, line: true, off: true };
    const ALL_VIEW_MODES: Record<ViewMode, true> = { wysiwyg: true, source: true };
    expect(Object.keys(ALL_MODES).sort()).toEqual(["dom", "line", "off"]);
    expect(Object.keys(ALL_VIEW_MODES).sort()).toEqual(["source", "wysiwyg"]);

    // The table really covers every declared ViewMode under both flag values, so "all
    // six cells" is an assertion rather than a claim in a comment.
    for (const mode of Object.keys(ALL_VIEW_MODES) as ViewMode[]) {
      expect(
        Object.prototype.hasOwnProperty.call(ALL_VIEW_MODES, mode),
        `ALL_VIEW_MODES owns ${mode}`,
      ).toBe(true);
      for (const enabled of [true, false]) {
        expect(
          TRUTH_TABLE.some((row) => row.viewMode === mode && row.enabled === enabled),
          `truth table covers (${String(enabled)}, "${mode}")`,
        ).toBe(true);
      }
    }
    expect(TRUTH_TABLE).toHaveLength(6);

    // M-1: the six cells. The `(true, undefined)` cell is the one with content —
    // `viewMode?: ViewMode` at useTOC.ts:34 is optional, and
    // `viewMode === "wysiwyg" ? "dom" : "line"` is silently wrong for every caller
    // that omits it.
    for (const row of TRUTH_TABLE) {
      expect(resolveSpyMode(row.enabled, row.viewMode), `cell ${row.label}`).toBe(row.expected);
    }
  });

  it("M-2: LAW exactly-one / no-silent-off over the declared domain", () => {
    // Domain is deliberately M-1's six cells only (round-3 narrowing). The out-of-union
    // codomain belongs to M-4; duplicating it here would consume the module-scope
    // one-shot before M-4 runs.
    const results: TocSpyMode[] = [];

    for (const row of TRUTH_TABLE) {
      const first = resolveSpyMode(row.enabled, row.viewMode);
      const second = resolveSpyMode(row.enabled, row.viewMode);

      expect(second, `${row.label} is deterministic across two evaluations`).toBe(first);
      expect(ALL_SPY_MODES, `${row.label} lands inside the closed codomain`).toContain(first);

      if (row.enabled) {
        // An early `if (!viewMode) return "off"` would ship Source with the spy dead
        // for every caller that omits viewMode — the exact class of bug being repaired.
        expect(first, `${row.label} has flag=true and must never resolve to "off"`).not.toBe(
          "off",
        );
        expect(
          ["dom", "line"],
          `${row.label} has flag=true and must resolve to a live mechanism`,
        ).toContain(first);
      } else {
        expect(first, `${row.label} has flag=false and must resolve to "off"`).toBe("off");
      }

      results.push(first);
    }

    // Wrong-reason guard: all three modes must actually occur, or "the result is in the
    // set" is satisfied by a constant function.
    expect(new Set(results).size).toBe(3);

    // The declared domain never reaches the warn path.
    expect(unknownModeWarnCalls()).toHaveLength(0);
  });

  // M-4 MUST BE LAST — see the file header. It is the sole owner of the warn path.
  it('M-4: out-of-union viewMode falls back to "line", distinct from undefined, warning once', () => {
    // Why "line" and not "dom": src/App.tsx:1139 is
    // `viewMode === "wysiwyg" ? <MilkdownEditor/> : <SplitView/>` — anything that is not
    // "wysiwyg" renders the SOURCE surface. A "dom" fallback arms the IntersectionObserver
    // against #source-container, which contains no .ProseMirror, so collectHeadingElements
    // returns [] (tocElementResolution.ts:122-124) and the outline silently stops tracking:
    // byte-for-byte the bug this work item exists to fix. (Plan amendment A-6.)
    const OUT_OF_UNION: readonly unknown[] = ["preview", "split", "editor-only", "", null];

    // Baseline inside this test: clearMocks resets the double before each case, and
    // M-1..M-3 never reach the path, so the one-shot is still unconsumed here.
    expect(unknownModeWarnCalls()).toHaveLength(0);

    for (const raw of OUT_OF_UNION) {
      const value = raw as unknown as ViewMode;
      expect(
        () => resolveSpyMode(true, value),
        `out-of-union ${JSON.stringify(raw)} must not throw`,
      ).not.toThrow();
      expect(resolveSpyMode(true, value), `out-of-union ${JSON.stringify(raw)} resolves`).toBe(
        "line",
      );
    }

    // Clause 1 — `undefined` and `null` must be PROVABLY distinguished. A
    // `if (!viewMode) return "dom"` truthiness check collapses them and passes every
    // other clause in this section; this is the assertion that kills it.
    expect(resolveSpyMode(true, undefined)).not.toBe(
      resolveSpyMode(true, null as unknown as ViewMode),
    );
    expect(resolveSpyMode(true, undefined), "undefined is the single documented exception").toBe(
      "dom",
    );
    expect(resolveSpyMode(true, null as unknown as ViewMode), "null is not undefined").toBe("line");

    // Clause 2 (Level 6 supplement) — one-shot across the whole five-row table, and
    // still one-shot after re-evaluating it.
    expect(unknownModeWarnCalls()).toHaveLength(1);
    expect(unknownModeWarnCalls()[0]).toMatchObject({
      event: UNKNOWN_MODE_EVENT,
      level: "warn",
    });
    for (const raw of OUT_OF_UNION) {
      expect(resolveSpyMode(true, raw as unknown as ViewMode)).toBe("line");
    }
    expect(unknownModeWarnCalls()).toHaveLength(1);

    // Clause 3 — the one-shot is NOT value-keyed. A sixth, different out-of-union value
    // never seen by the table must still produce zero additional warns; an implementation
    // keying the one-shot per distinct value passes clause 2 and ships a log line per
    // unknown value.
    expect(resolveSpyMode(true, "outline" as unknown as ViewMode)).toBe("line");
    expect(unknownModeWarnCalls()).toHaveLength(1);
  });
});
