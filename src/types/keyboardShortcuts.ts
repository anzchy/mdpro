/**
 * Purpose: the two keyboard-shortcut binding states that are not a chord
 * (ADR-0114 Decision 7), defined once for the frontend. The Rust twins live in
 * `src-tauri/src/models/keyboard_shortcuts.rs`; both are held to the contract
 * fixture's `$keyboardShortcutStates`. Also the wire shape of the applied
 * snapshot (`get_applied_shortcuts`, M1a WI-4), held to
 * `tests/fixtures/applied-shortcuts-contract.json`.
 *
 * @coordinates-with src/types/preferences.ts — `KeyboardShortcuts` stores
 *   these strings verbatim in place of a chord
 */
import type { KeyboardShortcuts } from "./preferences";

/** A binding the user deliberately left without a chord. */
export const UNASSIGNED_BINDING = "<unassigned>" as const;

/** A binding left to the system's own handling. */
export const SYSTEM_BINDING = "<system>" as const;

/** A stored binding value that is a state, not a chord. */
export type KeyboardShortcutState = typeof UNASSIGNED_BINDING | typeof SYSTEM_BINDING;

/**
 * One binding of the applied snapshot (`get_applied_shortcuts`, M1a WI-4,
 * ADR-0114): the chord the running app uses, or one of the two states. The
 * Rust twin is `AppliedBinding` in `src-tauri/src/services/applied_shortcuts.rs`;
 * both are held to `tests/fixtures/applied-shortcuts-contract.json`.
 */
export type AppliedBinding =
  | { state: "bound"; chord: string }
  | { state: "unassigned" }
  | { state: "system" };

/** Where the applied snapshot came from. */
export type AppliedShortcutsSource = "loaded" | "defaultsAfterLoadFailure";

/**
 * The applied keyboard-shortcut snapshot: resolved once at startup and fixed
 * for the run (restart-to-apply, ADR-0114). `bindings` has one entry per
 * `KeyboardShortcuts` field, under the same camelCase name.
 */
export interface AppliedShortcuts {
  keyboardShortcutsVersion: number;
  source: AppliedShortcutsSource;
  bindings: Record<keyof KeyboardShortcuts, AppliedBinding>;
}
