/**
 * Purpose: the hard owners the binding conflict filter checks a custom value
 * against (plan M1A-WI-8, matrix SD5, SD7, SD8): fixed keys and secondaries,
 * K5's reserved chords, and the editor-owned inventory, indexed by normal
 * form. Reached in production only through Settings' conflict check
 * (M1A-WI-10) until M1b.
 *
 * Key decisions:
 * - Precedence fixed (0) > native (1) > reserved (2) > editorOwned (3).
 * - An `implements(X)` row and a secondary of X are listed as X and never
 *   conflict with X itself (`except`).
 * - The stored-independent part is cached per tables object, platform and
 *   version; secondaries depend on availability overrides, so they are not.
 *
 * @coordinates-with src/commands/bindingConflicts.ts — the filter
 * @coordinates-with src-tauri/src/services/binding_conflicts_owners.rs — the Rust twin
 */
import { assertNever } from "./assertNever";
import type { BindingTables, SuppressReason } from "./bindingConflicts.types";
import { normaliseStored } from "./chord";
import type { CommandRow, OwnershipContext, Platform, Route } from "./commandTable.types";
import { keymapNameToStored } from "./editorOwnedChords";
import { ALL_CONTEXTS } from "./rowBuilders";

export type HardReason = Extract<SuppressReason, "fixed" | "native" | "reserved" | "editorOwned">;

export interface HardOwner {
  readonly chord: string;
  readonly id: string;
  readonly reason: HardReason;
  readonly precedence: number;
  readonly contexts: readonly OwnershipContext[];
  /** The command this owner never conflicts with. */
  readonly except?: string;
}

const PRECEDENCE: Readonly<Record<HardReason, number>> = { fixed: 0, native: 1, reserved: 2, editorOwned: 3 };
type Version = "v1" | "v2";
export type OwnerIndex = ReadonlyMap<string, readonly HardOwner[]>;

function fixedReason(route: Route): HardReason {
  switch (route) {
    case "native":
      return "native";
    case "frontend":
    case "rust-quit":
    case "rust-hide":
    case "unavailable":
      return "fixed";
  }
  return assertNever(route);
}

function owner(chord: string | null, id: string, reason: HardReason, contexts: readonly OwnershipContext[], except?: string): HardOwner[] {
  if (chord === null || contexts.length === 0) return [];
  return [{ chord, id, reason, precedence: PRECEDENCE[reason], contexts, ...(except === undefined ? {} : { except }) }];
}

function fixedOwners(row: CommandRow, p: Platform, ver: Version): HardOwner[] {
  const key = row.key[p];
  if (key.kind !== "fixed" || row.availability[p][ver] === "none") return [];
  const chords = [key.defaults[ver], ...key.secondaries[ver]];
  const reason = fixedReason(row.route[p]);
  return chords.flatMap((c) => owner(c === null ? null : normaliseStored(c, p), row.id, reason, row.contexts));
}

function inventoryOwners(tables: BindingTables, p: Platform): HardOwner[] {
  return tables.inventory.flatMap((r) => {
    if (!r.platforms.includes(p)) return [];
    const chord = keymapNameToStored(r.key, p);
    const d = r.disposition;
    switch (d.kind) {
      case "implements":
        return owner(chord, d.command, "editorOwned", r.contexts, d.command);
      case "editorOwned":
      case "removeInM1b":
      case "shadowed":
        return owner(chord, `editor:${r.source}:${r.key}`, "editorOwned", r.contexts);
    }
    return assertNever(d);
  });
}

const CACHE = new WeakMap<BindingTables, Map<string, OwnerIndex>>();

/** The stored-independent hard owners on `p` at `ver`, by normal form. */
export function hardOwnerIndex(tables: BindingTables, p: Platform, ver: Version): OwnerIndex {
  const perTables = CACHE.get(tables) ?? new Map<string, OwnerIndex>();
  CACHE.set(tables, perTables);
  const hit = perTables.get(`${p}@${ver}`);
  if (hit !== undefined) return hit;
  const all = [
    ...tables.rows.flatMap((r) => fixedOwners(r, p, ver)),
    ...tables.reserved[p].flatMap((c) => {
      const chord = normaliseStored(c, p);
      return owner(chord, `reserved:${chord ?? c}`, "reserved", ALL_CONTEXTS);
    }),
    ...inventoryOwners(tables, p),
  ];
  const index = new Map<string, HardOwner[]>();
  for (const o of all) index.set(o.chord, [...(index.get(o.chord) ?? []), o]);
  perTables.set(`${p}@${ver}`, index);
  return index;
}

/** A configurable row's fixed secondaries, acting where the row is available. */
export function secondaryOwners(
  rows: readonly { readonly row: CommandRow; readonly contexts: readonly OwnershipContext[] }[],
  p: Platform,
  ver: Version,
): HardOwner[] {
  return rows.flatMap(({ row, contexts }) =>
    row.key[p].kind === "configurable"
      ? row.key[p].secondaries[ver].flatMap((c) => owner(normaliseStored(c, p), row.id, "fixed", contexts, row.id))
      : [],
  );
}

/** The smallest id, or `null` for none (SD10, SD15). */
export function minId(ids: readonly string[]): string | null {
  return ids.length === 0 ? null : [...ids].sort()[0] ?? null;
}

/** The highest-precedence owner of `chord` in `context`, smallest id on a tie. */
export function topOwner(owners: readonly HardOwner[], context: OwnershipContext): string | null {
  const here = owners.filter((o) => o.contexts.includes(context));
  if (here.length === 0) return null;
  const top = Math.min(...here.map((o) => o.precedence));
  return minId(here.filter((o) => o.precedence === top).map((o) => o.id));
}
