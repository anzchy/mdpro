/**
 * WI-2 (ADR-0031 step 5a) — LVH-09: after settle, the `lastViewMode` write
 * sequence does not depend on whether a view-mode change and a new active
 * document land in the same React commit or in separate commits.
 *
 * Case LVH-09 of `.claude/tdd-guardian/tests-20260926-221500.md` (revision 3,
 * Defect B). Both changes are driven through **one** `rerender` carrying a new
 * `viewMode` prop and a new `docId`, so they share one update on one lane. The
 * harness's per-commit record then *checks* the grouping instead of assuming
 * it: if React ever split the (same) run, the case fails with a named message
 * rather than passing vacuously.
 *
 * Kills: a read effect that re-settles on every document change while a
 * document is active and runs before the write effect — in the (same) run it
 * re-baselines to the new mode and swallows the transition.
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke` (a stateful backend fake).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import type { ViewMode } from "../src/types/editor";
import { makePreferences } from "./support/preferenceFixtures";
import {
  answer,
  backend,
  callsFor,
  commits,
  dedupeConsecutive,
  flush,
  lastViewModeWrites,
  mountHarness,
  resetCase,
  teardownCase,
  type HarnessProps,
} from "./support/lastViewModeHarness";

const P = { loaded: true, launched: true, hasDoc: true } as const;
type Step = { docId: string; viewMode: ViewMode };
type Pair = [ViewMode, string | null];

interface RunResult {
  delta: Pair[];
  writes: ReturnType<typeof lastViewModeWrites>;
  disk: ViewMode;
  reads: number;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(answer);
});

afterEach(() => {
  teardownCase();
});

/** Settle as in LVH-05, then apply each step as one `rerender`, flushing after each. */
async function runSteps(steps: Step[]): Promise<RunResult> {
  resetCase(makePreferences({ lastViewMode: "wysiwyg" }));
  const h = mountHarness({ ...P, docId: "d1", viewMode: "wysiwyg" });
  await flush();
  const base = commits.length;
  for (const step of steps) {
    act(() => {
      h.rerender({ ...P, ...step } satisfies HarnessProps);
    });
    await flush();
  }
  const result: RunResult = {
    delta: dedupeConsecutive(commits.slice(base)),
    writes: lastViewModeWrites(),
    disk: backend.disk.lastViewMode as ViewMode,
    reads: callsFor("get_preferences").length,
  };
  h.unmount();
  return result;
}

describe("useLastViewModePersistence — commit-order independence (WI-2, LVH-09)", () => {
  it("LVH-09: a view-mode change and a new active document in the same commit still write the transition", async () => {
    const same = await runSteps([{ docId: "d2", viewMode: "source" }]);
    const modeFirst = await runSteps([
      { docId: "d1", viewMode: "source" },
      { docId: "d2", viewMode: "source" },
    ]);
    const docFirst = await runSteps([
      { docId: "d2", viewMode: "wysiwyg" },
      { docId: "d2", viewMode: "source" },
    ]);
    const control = await runSteps([{ docId: "d2", viewMode: "wysiwyg" }]);

    // Commit-grouping checks first: they make the relation non-vacuous.
    expect(
      same.delta,
      "(same) was not one commit; the metamorphic relation is untested",
    ).toEqual([["source", "d2"]]);
    expect(modeFirst.delta, "(mode-first) commit grouping").toEqual([
      ["source", "d1"],
      ["source", "d2"],
    ]);
    expect(docFirst.delta, "(doc-first) commit grouping").toEqual([
      ["wysiwyg", "d2"],
      ["source", "d2"],
    ]);
    expect(control.delta, "(control) commit grouping").toEqual([["wysiwyg", "d2"]]);

    const oneWrite = [{ preferences: { lastViewMode: "source" } }];
    expect(same.writes, "(same) writes").toEqual(oneWrite);
    expect(modeFirst.writes, "(mode-first) writes").toEqual(oneWrite);
    expect(docFirst.writes, "(doc-first) writes").toEqual(oneWrite);
    expect(same.writes, "relation: (same) == (mode-first)").toEqual(modeFirst.writes);
    expect(same.writes, "relation: (same) == (doc-first)").toEqual(docFirst.writes);
    expect(control.writes, "(control) a document change alone never writes").toEqual([]);

    expect(same.disk, "(same) disk").toBe("source");
    expect(modeFirst.disk, "(mode-first) disk").toBe("source");
    expect(docFirst.disk, "(doc-first) disk").toBe("source");
    expect(control.disk, "(control) disk").toBe("wysiwyg");

    for (const [name, r] of Object.entries({ same, modeFirst, docFirst, control })) {
      expect(r.reads, `(${name}) a document is active throughout: no read`).toBe(0);
    }
  });
});
