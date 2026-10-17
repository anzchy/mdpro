/**
 * Purpose: the binding conflict filter (plan M1A-WI-8, § 5.6, ADR-0114
 * Decision 5): resolves every configurable row's stored key for a platform
 * and defaults version into a `Resolution`, and answers who owns a chord in
 * a context. The Rust twin is `src-tauri/src/services/binding_conflicts.rs`;
 * both are held to `tests/fixtures/binding-owner-cases.json` (`cases`, and
 * the generated `sweep`). Inert until M1b: no production module imports it,
 * and nothing feeds the menu, the hook or the applied snapshot from it.
 *
 * Pipeline: hard-owner index (fixed keys and secondaries, reserved chords,
 * the editor inventory) → classify each row (sentinel, unparseable,
 * unavailable, default, custom) → customs vs hard owners and each other →
 * defaults yield to bound customs → unavailable rows record who took their
 * chord.
 *
 * Key decisions (matrix SD4–SD16):
 * - "Custom" = the normal form differs from the row's default (SD4).
 * - A default is never suppressed by a hard owner or a sibling default; it
 *   yields only to a bound custom (SD6).
 * - `conflictsWith` is sorted and de-duplicated; a displaced default is not
 *   listed (SD7). Reason precedence fixed > native > reserved > editorOwned;
 *   `customDuplicate` only without a hard owner (SD8).
 * - Ties among owners of equal precedence go to the smallest id (SD15), so
 *   no result depends on table, inventory or stored-map order.
 *
 * @coordinates-with src/commands/bindingOwners.ts — the hard-owner index
 * @coordinates-with src/commands/chord.ts — normal form
 */
import { availabilityContexts } from "./commandHelpers";
import { COMMAND_TABLE } from "./commandTable";
import type { Availability, CommandRow, OwnershipContext, Platform } from "./commandTable.types";
import { normaliseStored } from "./chord";
import { EDITOR_OWNED_CHORDS } from "./editorOwnedChords";
import { RESERVED_CHORDS } from "./reservedChords";
import { type HardOwner, hardOwnerIndex, minId, secondaryOwners, topOwner } from "./bindingOwners";
import type {
  AvailabilityOverride,
  BindingState,
  BindingTables,
  Resolution,
  StoredBindings,
} from "./bindingConflicts.types";

export type * from "./bindingConflicts.types";

const UNASSIGNED = "<unassigned>";
const SYSTEM = "<system>";
const PRODUCTION: BindingTables = { rows: COMMAND_TABLE, reserved: RESERVED_CHORDS, inventory: EDITOR_OWNED_CHORDS };

interface Entry {
  readonly row: CommandRow;
  readonly field: string;
  readonly chord: string | null;
  /** Contexts it binds in (empty when unavailable). */
  readonly active: readonly OwnershipContext[];
  /** Contexts an unavailable row reserves its chord in. */
  readonly reserve: readonly OwnershipContext[];
  readonly custom: boolean;
}

const intersects = (a: readonly OwnershipContext[], b: readonly OwnershipContext[]) => a.some((c) => b.includes(c));
const sorted = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();
const suppressed = (reason: Resolution & { kind: "suppressed" }): Resolution => reason;

function entryOf(
  row: CommandRow,
  field: string,
  p: Platform,
  ver: "v1" | "v2",
  stored: StoredBindings,
  override: Availability | undefined,
): { entry: Entry; value: string } {
  const def = row.key[p].defaults[ver] ?? "";
  const raw = stored[field];
  const value = typeof raw === "string" ? raw : def;
  const avail = override ?? row.availability[p][ver];
  const contexts = override !== undefined && override !== "none" ? availabilityContexts(override) : row.contexts;
  const allowed = availabilityContexts(avail);
  const chord = normaliseStored(value, p);
  return {
    value,
    entry: {
      row,
      field,
      chord,
      active: contexts.filter((c) => allowed.includes(c)),
      reserve: contexts,
      custom: chord !== normaliseStored(def, p),
    },
  };
}

/** Resolve every configurable row of `tables` (tests pass permuted tables). */
export function resolveWith(
  tables: BindingTables,
  platform: Platform,
  defaultsVersion: number,
  stored: StoredBindings,
  override: AvailabilityOverride = {},
): BindingState {
  const ver = defaultsVersion >= 2 ? "v2" : "v1";
  const out: Record<string, Resolution> = {};
  const entries: Entry[] = [];
  const live: Entry[] = [];
  const reservers: Entry[] = [];
  for (const row of tables.rows) {
    if (row.prefField === undefined) continue;
    const field = String(row.prefField);
    const { entry, value } = entryOf(row, field, platform, ver, stored, override[field]);
    entries.push(entry);
    if (value === UNASSIGNED) out[field] = { kind: "unassigned" };
    else if (value === SYSTEM) out[field] = { kind: "system" };
    else if (entry.chord === null) out[field] = suppressed({ kind: "suppressed", reason: "unparseable", conflictsWith: [], flagged: true });
    else if (entry.active.length === 0) reservers.push(entry);
    else live.push(entry);
  }
  const index = hardOwnerIndex(tables, platform, ver);
  const secondaries = secondaryOwners(entries.map((e) => ({ row: e.row, contexts: e.active })), platform, ver);
  const hardFor = (chord: string): HardOwner[] => [...(index.get(chord) ?? []), ...secondaries.filter((o) => o.chord === chord)];
  const customs = live.filter((e) => e.custom);
  const boundCustoms: Entry[] = [];
  for (const e of customs) {
    const chord = e.chord ?? "";
    const owners = hardFor(chord).filter((o) => o.except !== e.row.id && intersects(o.contexts, e.active));
    const dups = customs.filter((d) => d !== e && d.chord === chord && intersects(d.active, e.active));
    if (owners.length > 0) {
      const top = Math.min(...owners.map((o) => o.precedence));
      const reason = owners.find((o) => o.precedence === top)?.reason ?? "editorOwned";
      const ids = [...owners.map((o) => o.id), ...dups.map((d) => d.row.id)];
      out[e.field] = suppressed({ kind: "suppressed", reason, conflictsWith: sorted(ids), flagged: true });
    } else if (dups.length > 0) {
      const ids = sorted(dups.map((d) => d.row.id));
      out[e.field] = suppressed({ kind: "suppressed", reason: "customDuplicate", conflictsWith: ids, flagged: true });
    } else {
      out[e.field] = { kind: "bound", chord };
      boundCustoms.push(e);
    }
  }
  const takers = (e: Entry, ctx: readonly OwnershipContext[]) =>
    boundCustoms.filter((c) => c !== e && c.chord === e.chord && intersects(c.active, ctx)).map((c) => c.row.id);
  for (const e of live.filter((x) => !x.custom)) {
    const by = takers(e, e.active);
    out[e.field] = by.length > 0
      ? suppressed({ kind: "suppressed", reason: "yieldedToCustom", conflictsWith: sorted(by), flagged: false })
      : { kind: "bound", chord: e.chord ?? "" };
  }
  for (const e of reservers) {
    const by = sorted(takers(e, e.reserve));
    out[e.field] = suppressed({ kind: "suppressed", reason: "unavailable", conflictsWith: by, flagged: false });
  }
  const byChord = (es: readonly Entry[]) => {
    const m = new Map<string, Entry[]>();
    for (const e of es) if (e.chord !== null) m.set(e.chord, [...(m.get(e.chord) ?? []), e]);
    return m;
  };
  const bound = byChord(live.filter((e) => out[e.field]?.kind === "bound"));
  const reserving = byChord(reservers);
  const resolutions = Object.fromEntries(Object.keys(out).sort().map((f) => [f, out[f] as Resolution]));
  return {
    resolutions,
    ownerOf(context: OwnershipContext, chordText: string): string | null {
      const chord = normaliseStored(chordText, platform);
      if (chord === null) return null;
      const pick = (es: readonly Entry[] | undefined, ctx: (e: Entry) => readonly OwnershipContext[]) =>
        minId((es ?? []).filter((e) => ctx(e).includes(context)).map((e) => e.row.id));
      return topOwner(hardFor(chord), context) ?? pick(bound.get(chord), (e) => e.active) ?? pick(reserving.get(chord), (e) => e.reserve);
    },
  };
}

/** Each configurable field's resolution with the production tables. */
export function resolveBindings(platform: Platform, defaultsVersion: number, stored: StoredBindings) {
  return resolveWith(PRODUCTION, platform, defaultsVersion, stored).resolutions;
}

/** Who owns `chord` in `context` for this input (SD10); `null` if no one. */
export function ownerOf(
  platform: Platform,
  defaultsVersion: number,
  stored: StoredBindings,
  context: OwnershipContext,
  chord: string,
): string | null {
  return resolveWith(PRODUCTION, platform, defaultsVersion, stored).ownerOf(context, chord);
}
