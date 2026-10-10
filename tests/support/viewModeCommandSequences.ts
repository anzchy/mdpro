/**
 * @module tests/support/viewModeCommandSequences
 * Purpose: the view-mode command domain shared by the D24 suites split across
 * the unit and slow tiers (ADR-0050): `view-mode-intent` (VMI-06, length <= 4)
 * and `view-mode-intent.slow` (VMI-06s, length <= 6). One definition, so the
 * slow half sweeps exactly the alphabet, model and checks the unit half does.
 *
 * Contents:
 *   - `COMMAND_ALPHABET`: {user, programmatic} x {set wysiwyg, set source, cycle}.
 *   - `allCommandSequences(maxLength)`: every sequence of length 0..maxLength.
 *   - `checkViewModeLaws(sequences, options)`: runs each sequence through the
 *     real editor store and returns the counterexamples (empty when the
 *     counting and agreement laws hold after every prefix).
 *
 * The model is independent of the store: `set m` lands on `m`, `cycle` toggles
 * the model's current mode, and both intents advance it.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

import { useEditorStore } from "../../src/stores/editorStore";
import type { ViewMode } from "../../src/types/editor";

export type CommandIntent = "user" | "programmatic";
export type CommandAction = { kind: "set"; mode: ViewMode } | { kind: "cycle" };
export interface ViewModeCommand {
  intent: CommandIntent;
  action: CommandAction;
}

const ACTIONS: readonly CommandAction[] = [
  { kind: "set", mode: "wysiwyg" },
  { kind: "set", mode: "source" },
  { kind: "cycle" },
];

export const COMMAND_ALPHABET: readonly ViewModeCommand[] = (["user", "programmatic"] as const).flatMap(
  (intent) => ACTIONS.map((action) => ({ intent, action })),
);

/** Every sequence over `COMMAND_ALPHABET` of length 0..maxLength (shortest first). */
export function allCommandSequences(maxLength: number): ViewModeCommand[][] {
  const out: ViewModeCommand[][] = [[]];
  let layer: ViewModeCommand[][] = [[]];
  for (let length = 1; length <= maxLength; length += 1) {
    layer = layer.flatMap((prefix) => COMMAND_ALPHABET.map((c) => [...prefix, c]));
    out.push(...layer);
  }
  return out;
}

export function describeCommand(c: ViewModeCommand): string {
  const what = c.action.kind === "set" ? `set ${c.action.mode}` : "cycle";
  return `${c.intent}:${what}`;
}

function toggle(mode: ViewMode): ViewMode {
  return mode === "wysiwyg" ? "source" : "wysiwyg";
}

function run(c: ViewModeCommand, explicitProgrammatic: boolean): void {
  const store = useEditorStore.getState();
  if (c.intent === "user") {
    if (c.action.kind === "set") store.setViewMode(c.action.mode, "user");
    else store.cycleViewMode("user");
    return;
  }
  // Default-intent programmatic calls pass no argument, so the default is under test.
  if (c.action.kind === "set") {
    if (explicitProgrammatic) store.setViewMode(c.action.mode, "programmatic");
    else store.setViewMode(c.action.mode);
  } else if (explicitProgrammatic) store.cycleViewMode("programmatic");
  else store.cycleViewMode();
}

export interface LawCheckOptions {
  /** Pass `"programmatic"` explicitly instead of relying on the default. */
  explicitProgrammatic: boolean;
  /** Stop collecting after this many counterexamples. */
  maxFailures?: number;
}

/**
 * VMI-06 (i)-(v), checked after every prefix of every sequence. Each sequence
 * starts from `viewMode = "wysiwyg"` and choice `{ seq: 0, mode: "wysiwyg" }`.
 */
export function checkViewModeLaws(
  sequences: readonly ViewModeCommand[][],
  options: LawCheckOptions,
): string[] {
  const failures: string[] = [];
  const maxFailures = options.maxFailures ?? 10;
  for (const sequence of sequences) {
    useEditorStore.setState({ viewMode: "wysiwyg", userViewModeChoice: { seq: 0, mode: "wysiwyg" } });
    let modelMode: ViewMode = "wysiwyg";
    let userCount = 0;
    let lastUserLanded: ViewMode = "wysiwyg";
    for (let i = 0; i < sequence.length; i += 1) {
      const c = sequence[i];
      const before = useEditorStore.getState().userViewModeChoice;
      run(c, options.explicitProgrammatic);
      modelMode = c.action.kind === "set" ? c.action.mode : toggle(modelMode);
      if (c.intent === "user") {
        userCount += 1;
        lastUserLanded = modelMode;
      }
      const { viewMode, userViewModeChoice: choice } = useEditorStore.getState();
      const problems: string[] = [];
      if (choice?.seq !== userCount) problems.push(`(i) seq ${choice?.seq} !== ${userCount}`);
      if (choice?.mode !== lastUserLanded) problems.push(`(ii) mode ${choice?.mode} !== ${lastUserLanded}`);
      if (c.intent === "user" && choice?.mode !== viewMode) {
        problems.push(`(iii) choice.mode ${choice?.mode} !== viewMode ${viewMode}`);
      }
      const unchanged = choice?.seq === before?.seq && choice?.mode === before?.mode;
      if (c.intent === "programmatic" && !unchanged) {
        problems.push(`(iv) choice ${JSON.stringify(before)} -> ${JSON.stringify(choice)}`);
      }
      if (viewMode !== modelMode) problems.push(`(v) viewMode ${viewMode} !== model ${modelMode}`);
      if (problems.length > 0) {
        const prefix = sequence.slice(0, i + 1).map(describeCommand).join(", ");
        failures.push(`[${prefix}] ${problems.join("; ")}`);
        break;
      }
    }
    if (failures.length >= maxFailures) break;
  }
  return failures;
}

/*
 * D24 WI-3 (LVI-09 / LVI-09s): the SET-ONLY sub-domain for the persistence
 * law of `useLastViewModePersistence`. Cycles are excluded: a cycle's target
 * depends on the (possibly programmatic) mode on screen, so erasing the
 * programmatic commands would change what a later user cycle lands on.
 * Appended rather than woven into the header so the WI-1 receipt's recorded
 * lines above stay byte-identical.
 */

/** A set-only command: an intent and the mode it sets. */
export interface SetCommand {
  intent: CommandIntent;
  mode: ViewMode;
}

const SET_ALPHABET: readonly SetCommand[] = (["user", "programmatic"] as const).flatMap((intent) =>
  (["wysiwyg", "source"] as const).map((mode) => ({ intent, mode })),
);

/** Every set-only sequence of length 1..maxLength (shortest first): Σ 4^k sequences. */
export function setOnlySequences(maxLength: number): SetCommand[][] {
  const out: SetCommand[][] = [];
  let layer: SetCommand[][] = [[]];
  for (let length = 1; length <= maxLength; length += 1) {
    layer = layer.flatMap((prefix) => SET_ALPHABET.map((c) => [...prefix, c]));
    out.push(...layer);
  }
  return out;
}

export function describeSetCommand(c: SetCommand): string {
  return `${c.intent}:${c.mode}`;
}

/**
 * Collapse runs of equal adjacent values: the closed-form oracle for the
 * write list, `runLengthDedupe([stored, ...userTargets]).slice(1)`. Shares no
 * code with `src/utils/lastViewModeLatch.ts`.
 */
export function runLengthDedupe<T>(values: readonly T[]): T[] {
  const out: T[] = [];
  for (const v of values) {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}
