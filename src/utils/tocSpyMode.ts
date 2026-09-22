/**
 * Purpose: route the outline's scroll spy to **one** mechanism, so that
 * `enableSpyScrolling` stops doing double duty. After this module, the flag is a master
 * switch only ("spy at all") and `resolveSpyMode` decides the mechanism: the WYSIWYG
 * geometric spy (`"dom"`), the Source line sampler (`"line"`), or nothing
 * (`"off"`).
 *
 * `@module src/utils/tocSpyMode`
 * `@coordinates-with` `src/hooks/useTOC.ts` (the sole caller: gates the WYSIWYG spy on
 * `"dom"` and `useSourceScrollSpy` on `"line"`), `src/types/editor.ts` (`ViewMode`),
 * `src/services/loggingService.ts` (the one-shot warn below).
 *
 * Law: **totality and mutual exclusivity** — every `(flag, viewMode)` pair maps to exactly
 * one of three values, and `flag === true` never yields `"off"`. A flag that is on must
 * always leave some mechanism live; silently resolving to `"off"` is how the spy dies
 * without anyone noticing.
 *
 * ---------------------------------------------------------------------------
 * Why an unrecognised `viewMode` falls back to `"line"` and not `"dom"`
 * ---------------------------------------------------------------------------
 * `src/App.tsx:1139` is `viewMode === "wysiwyg" ? <MilkdownEditor/> : <SplitView/>`.
 * **Anything that is not `"wysiwyg"` renders the Source surface.** Routing an unknown
 * value to `"dom"` would arm the WYSIWYG spy against `#source-container`, which
 * contains no `.ProseMirror`, so `collectHeadingElements` returns `[]`
 * (`src/utils/tocElementResolution.ts:122-124`), nothing resolves, and the outline
 * silently stops tracking — reproducing the exact bug this module exists to prevent.
 * `"line"` matches what is actually on screen.
 *
 * `undefined` is the **single documented exception**: it stays `"dom"`, preserving today's
 * default for callers that omit the optional `viewMode` prop (`useTOC.ts:34`). It must stay
 * distinguishable from `null` — a truthiness check that collapses the two is a defect, not
 * an equivalent implementation.
 *
 * **Honest reachability note**: the unknown-value path is *low reachability today*.
 * `migrateViewMode` (`src/utils/viewModeUtils.ts:14-19`) sanitizes every unknown value to
 * `"wysiwyg"` at the persistence boundary. This fallback is a defence against a future
 * third `ViewMode` or a call site that bypasses the migration, not a live bug.
 */
import { loggingService } from "../services/loggingService";
import type { ViewMode } from "../types/editor";

export type TocSpyMode = "dom" | "line" | "off";

/**
 * One-shot latch for the unknown-`viewMode` warning.
 *
 * Module scope, and deliberately **not** keyed per value: `resolveSpyMode` is called from
 * a React render path that a re-render can hit repeatedly, and a per-value key would still
 * emit one JSONL line per distinct bad value. One line per process is enough to debug it.
 */
let hasWarnedUnknownViewMode = false;

function warnUnknownViewMode(received: unknown): void {
  if (hasWarnedUnknownViewMode) return;
  hasWarnedUnknownViewMode = true;

  loggingService.logEventSync({
    level: "warn",
    event: "ui.toc.spy.mode.unknown",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: {
      screen: "editor",
      received: received === null ? "null" : String(received),
      receivedType: typeof received,
      resolvedMode: "line",
      reason: "unrecognised ViewMode; App renders the source surface for anything but wysiwyg",
    },
  });
}

/**
 * Decide which scroll-spy mechanism the outline should run.
 *
 * @param enableSpyScrolling master switch — `false` disables the spy entirely.
 * @param viewMode the active editor surface; `undefined` means the caller omitted the
 *   optional prop and keeps today's `"dom"` default.
 * @returns exactly one of `"dom"` (the geometric spy over the WYSIWYG surface),
 *   `"line"` (CodeMirror line sampling over the Source surface), or `"off"`.
 */
export function resolveSpyMode(
  enableSpyScrolling: boolean,
  viewMode: ViewMode | undefined,
): TocSpyMode {
  if (!enableSpyScrolling) return "off";

  // Strict `=== undefined`, never a truthiness check: `null` and `""` are unknown values
  // and must reach the fallback below, while an omitted prop must not.
  if (viewMode === undefined) return "dom";

  switch (viewMode) {
    case "wysiwyg":
      return "dom";
    case "source":
      return "line";
    default: {
      // Rule 60 "Enum and union completeness": adding a third `ViewMode` without adding a
      // case here is a compile error (`tsc --noEmit`), not a value that silently falls
      // through. At runtime this arm is reached only by a value that lied about its type.
      const unrecognised: never = viewMode;
      warnUnknownViewMode(unrecognised);
      return "line";
    }
  }
}
