/**
 * @module tests/support/lastViewModeLaw
 * Purpose: the D24 WI-3 persistence law (LVI-09 in the unit tier, LVI-09s in
 * the slow tier, ADR-0050), run through the real `useLastViewModePersistence`
 * via `tests/support/lastViewModeHarness.ts`. One runner, so the slow half
 * checks exactly what the unit half checks.
 *
 * Law (matrix `.claude/tdd-guardian/tests-20261007-171405.md`, WI-3 unit):
 *   after settle, `lastViewMode` writes are a function of the USER commands.
 *   (i)   erasure: deleting every programmatic command leaves the writes equal;
 *   (ii)  closed form: writes === runLengthDedupe([stored, ...userTargets]).slice(1);
 *   (iii) disk === last write, or `stored` when there is none;
 *   (iv)  non-vacuity: the store shows the last command's target, whatever
 *         its intent (programmatic commands still switch).
 *
 * The caller owns the `vi.mock` of `@tauri-apps/api/core`, routed to the
 * harness `answer`, exactly as for the harness itself.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */
import { act } from "@testing-library/react";
import { useLoggingStore } from "../../src/stores/loggingStore";
import type { ViewMode } from "../../src/types/editor";
import { makePreferences } from "./preferenceFixtures";
import {
  backend,
  flush,
  lastViewModeWrites,
  mountHarness,
  resetCase,
  resolveRead,
  setMode,
  setModeProgrammatic,
  storeMode,
} from "./lastViewModeHarness";
import { describeSetCommand, runLengthDedupe, type SetCommand } from "./viewModeCommandSequences";

const SETTLED = { loaded: true, launched: true } as const;

interface RunResult {
  writes: ViewMode[];
  disk: ViewMode;
  mode: ViewMode;
}

/** Settle through the read with `stored` on disk, open a document, run `commands`. */
async function runOnce(stored: ViewMode, commands: readonly SetCommand[], logging: boolean): Promise<RunResult> {
  resetCase(makePreferences({ lastViewMode: stored }));
  if (!logging) useLoggingStore.setState({ enabled: false });
  const h = mountHarness({ ...SETTLED, hasDoc: false });
  await flush();
  await resolveRead();
  act(() => {
    h.rerender({ ...SETTLED, hasDoc: true });
  });
  await flush();
  for (const c of commands) {
    if (c.intent === "user") setMode(c.mode);
    else setModeProgrammatic(c.mode);
    await flush();
  }
  const result: RunResult = {
    writes: lastViewModeWrites().map((p) => p.preferences.lastViewMode as ViewMode),
    disk: backend.disk.lastViewMode as ViewMode,
    mode: storeMode(),
  };
  h.unmount();
  return result;
}

export interface LawOptions {
  /** Keep `preferences.last_view_mode` logging on (the slow tier turns it off). */
  logging: boolean;
  /** Stop collecting after this many counterexamples. */
  maxFailures?: number;
}

/** Run every `stored × sequence` row; return counterexamples (empty when the law holds). */
export async function checkLastViewModeLaw(
  sequences: readonly SetCommand[][],
  options: LawOptions,
): Promise<string[]> {
  const failures: string[] = [];
  const maxFailures = options.maxFailures ?? 10;
  for (const stored of ["wysiwyg", "source"] as const) {
    for (const sequence of sequences) {
      const userOnly = sequence.filter((c) => c.intent === "user");
      const full = await runOnce(stored, sequence, options.logging);
      const erased = await runOnce(stored, userOnly, options.logging);
      const expected = runLengthDedupe([stored, ...userOnly.map((c) => c.mode)]).slice(1);
      const problems: string[] = [];
      const same = (a: ViewMode[], b: ViewMode[]) => JSON.stringify(a) === JSON.stringify(b);
      if (!same(full.writes, erased.writes)) {
        problems.push(`(i) W ${JSON.stringify(full.writes)} !== W' ${JSON.stringify(erased.writes)}`);
      }
      if (!same(full.writes, expected)) {
        problems.push(`(ii) W ${JSON.stringify(full.writes)} !== ${JSON.stringify(expected)}`);
      }
      const expectedDisk = full.writes.at(-1) ?? stored;
      if (full.disk !== expectedDisk) problems.push(`(iii) disk ${full.disk} !== ${expectedDisk}`);
      const lastTarget = sequence[sequence.length - 1].mode;
      if (full.mode !== lastTarget) problems.push(`(iv) store ${full.mode} !== ${lastTarget}`);
      if (problems.length > 0) {
        failures.push(`stored=${stored} [${sequence.map(describeSetCommand).join(", ")}] ${problems.join("; ")}`);
        if (failures.length >= maxFailures) return failures;
      }
    }
  }
  return failures;
}
