/**
 * Purpose: the two keyboard-shortcut binding states that are not a chord
 * (ADR-0114 Decision 7), defined once for the frontend. The Rust twins live in
 * `src-tauri/src/models/keyboard_shortcuts.rs`; both are held to the contract
 * fixture's `$keyboardShortcutStates`.
 *
 * @coordinates-with src/types/preferences.ts — `KeyboardShortcuts` stores
 *   these strings verbatim in place of a chord
 */

/** A binding the user deliberately left without a chord. */
export const UNASSIGNED_BINDING = "<unassigned>" as const;

/** A binding left to the system's own handling. */
export const SYSTEM_BINDING = "<system>" as const;

/** A stored binding value that is a state, not a chord. */
export type KeyboardShortcutState = typeof UNASSIGNED_BINDING | typeof SYSTEM_BINDING;
