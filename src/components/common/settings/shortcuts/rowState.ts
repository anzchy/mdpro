/**
 * Purpose: the state of one Settings › Keyboard Shortcuts row, as DESIGN.md's
 * "Native menu bar and Keyboard Shortcuts page" block draws it (plan § 6
 * M7, D8). Pure: the page passes in what it loaded and what is being edited.
 *
 * Key decisions:
 * - `unavailable` (availability `none`): no key button. `fixed` (a fixed key)
 *   and `system` (a configurable row whose default is `<system>`): the key
 *   in a non-editable box. Everything else is `configurable`.
 * - In v1, the capability line is the row's `nativeBehaviour` text off-Mac
 *   (D19: Find's "WYSIWYG: browser find bar"); otherwise it follows the
 *   version's availability. It states what the command can do, never the
 *   window's current mode (§ 5.5).
 * - The key-kind branch is an exhaustive switch ending in `assertNever`
 *   (rule 60).
 * - Pending compares the saved value with the run's applied snapshot, never
 *   the unsaved edit (ADR-0114 Decision 4). Suppression comes from the
 *   startup snapshot and stays visible until the next launch.
 *
 * @coordinates-with src/commands/commandTable.types.ts — the row shape
 * @coordinates-with src/types/keyboardShortcuts.ts — AppliedBinding
 * @coordinates-with src/components/common/settings/shortcuts/ShortcutRow.tsx — draws it
 */
import { assertNever } from "../../../../commands/assertNever";
import type { SuppressReason } from "../../../../commands/bindingConflicts.types";
import type { BindingField } from "../../../../commands/bindingConflicts.types";
import { normaliseStored } from "../../../../commands/chord";
import { effectiveImageShortcut } from "../../../../commands/legacyImageShortcut";
import type { Availability, CommandRow, Platform } from "../../../../commands/commandTable.types";
import {
  SYSTEM_BINDING,
  UNASSIGNED_BINDING,
  type AppliedBinding,
} from "../../../../types/keyboardShortcuts";

type Stored = Readonly<Partial<Record<BindingField, string>>>;

export interface RowStateInput {
  readonly row: CommandRow;
  readonly platform: Platform;
  readonly version: number;
  /** The values being edited. */
  readonly local: Stored;
  /** The values last loaded from or written to the file. */
  readonly saved: Stored;
  /** The run's applied snapshot, or null when it could not be read. */
  readonly applied: Readonly<Partial<Record<BindingField, AppliedBinding>>> | null;
  readonly conflicts: { has(field: BindingField): boolean };
}

/** The active key and the one the next launch applies, in stored syntax. */
export interface Pending {
  readonly active: string;
  readonly afterRestart: string;
}

export type RowState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "fixed"; readonly key: string; readonly secondaries: readonly string[] }
  | { readonly kind: "system"; readonly secondaries: readonly string[] }
  | {
      readonly kind: "configurable";
      readonly value: string;
      readonly capability: string | null;
      readonly secondaries: readonly string[];
      readonly conflict: boolean;
      readonly pending: Pending | null;
      readonly suppressed: SuppressReason | null;
    };

function capabilityText(availability: Availability): string | null {
  switch (availability) {
    case "W":
      return "WYSIWYG only";
    case "S":
      return "Source only";
    case "both":
    case "none":
      return null;
    default:
      return assertNever(availability);
  }
}

function appliedAsStored(binding: AppliedBinding): string {
  switch (binding.state) {
    case "bound":
      return binding.chord;
    case "unassigned":
      return UNASSIGNED_BINDING;
    case "system":
      return SYSTEM_BINDING;
    case "suppressed":
      return UNASSIGNED_BINDING;
    default:
      return assertNever(binding);
  }
}

function sameBinding(a: string, b: string, platform: Platform): boolean {
  if (a === b) return true;
  const na = normaliseStored(a, platform);
  return na !== null && na === normaliseStored(b, platform);
}

function pendingOf(input: RowStateInput, field: BindingField, fallback: string): Pending | null {
  const binding = input.applied?.[field];
  if (binding === undefined) return null;
  const raw = input.saved[field];
  // "" means the default; Rust's snapshot binds it to the default too.
  const saved = field === "formatImage"
    ? effectiveImageShortcut(input.platform, raw ?? fallback)
    : raw === undefined || raw === "" ? fallback : raw;
  const active = appliedAsStored(binding);
  return sameBinding(saved, active, input.platform) ? null : { active, afterRestart: saved };
}

/** The row's state, or null when the row has no Settings row (a fixed row with no key). */
export function rowStateOf(input: RowStateInput): RowState | null {
  const { row, platform } = input;
  const ver = input.version >= 2 ? "v2" : "v1";
  const availability = row.availability[platform][ver];
  const key = row.key[platform];
  const secondaries = key.secondaries[ver];
  switch (key.kind) {
    case "fixed": {
      const fixedKey = key.defaults[ver];
      if (fixedKey === null) return null;
      if (availability === "none") return { kind: "unavailable" };
      return { kind: "fixed", key: fixedKey, secondaries };
    }
    case "configurable":
      break;
    default:
      return assertNever(key);
  }
  if (availability === "none") return { kind: "unavailable" };
  const fallback = key.defaults[ver];
  if (fallback === SYSTEM_BINDING) return { kind: "system", secondaries };
  const field = row.prefField;
  if (field === undefined) return null;
  return {
    kind: "configurable",
    value: field === "formatImage"
      ? effectiveImageShortcut(platform, input.local[field] ?? fallback)
      : input.local[field] ?? fallback,
    // nativeBehaviour describes v1 off-Mac fallback only (D19).
    capability:
      ver === "v1" && platform !== "macos" && row.nativeBehaviour !== undefined
        ? row.nativeBehaviour
        : capabilityText(availability),
    secondaries,
    conflict: input.conflicts.has(field),
    pending: pendingOf(input, field, fallback),
    suppressed: input.applied?.[field]?.state === "suppressed" ? input.applied[field].reason : null,
  };
}
