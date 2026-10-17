/**
 * Purpose: the shapes of the binding conflict filter (plan M1A-WI-8, § 5.6,
 * ADR-0114 Decision 5): what each configurable row resolves to, and the
 * tables the filter reads. Types only. The Rust twin is
 * `src-tauri/src/services/binding_conflicts.rs`; both serialise a
 * `Resolution` to the same JSON (`tests/fixtures/binding-owner-cases.json`).
 *
 * @coordinates-with src/commands/bindingConflicts.ts — the filter
 */
import type { KeyboardShortcuts } from "../types/preferences";
import type { Availability, CommandRow, OwnershipContext, PerPlatform } from "./commandTable.types";
import type { EditorOwnedRow } from "./editorOwnedChords";

/** Why a row binds nothing (matrix SD8). */
export type SuppressReason =
  | "fixed"
  | "native"
  | "reserved"
  | "editorOwned"
  | "customDuplicate"
  | "yieldedToCustom"
  | "unavailable"
  | "unparseable"
  | "physicalOverlap";

export type Resolution =
  | { readonly kind: "bound"; readonly chord: string }
  | { readonly kind: "unassigned" }
  | { readonly kind: "system" }
  | {
      readonly kind: "suppressed";
      readonly reason: SuppressReason;
      /** Sorted, de-duplicated owner ids (SD7). */
      readonly conflictsWith: readonly string[];
      readonly flagged: boolean;
    };

export type BindingField = keyof KeyboardShortcuts;

/** One `Resolution` per configurable row, keyed by its `prefField`. */
export type Resolutions = Readonly<Record<string, Resolution>>;

/** The stored map: field name → stored string. Unknown names are ignored. */
export type StoredBindings = Readonly<Partial<Record<string, string>>>;

/** Per-field availability that replaces the row's at both versions (tests). */
export type AvailabilityOverride = Readonly<Partial<Record<string, Availability>>>;

/** What the filter reads; production passes the command table modules. */
export interface BindingTables {
  readonly rows: readonly CommandRow[];
  readonly reserved: PerPlatform<readonly string[]>;
  readonly inventory: readonly EditorOwnedRow[];
}

export interface BindingState {
  readonly resolutions: Resolutions;
  /** Who owns `chord` (stored syntax) in `context` (SD10, SD15); `null` if no one. */
  ownerOf(context: OwnershipContext, chord: string): string | null;
}
