/**
 * @module tests/support/bindingSweep
 * Purpose: the M1A-WI-8 enumerated domain (matrix § M1A-WI-8 sweeps, R1-3),
 * shared by `tests/binding-conflicts.test.ts` and its slow sibling
 * (ADR-0050): the 19-value pool, the 58 fields × 3 platforms × v1/v2 inputs,
 * the law-1 checker, and the generator of the `sweep` section that Rust
 * replays for TS ⇄ Rust parity. DOM-free.
 */
import { resolveWith } from "../../src/commands/bindingConflicts";
import type { BindingTables, Resolution, Resolutions } from "../../src/commands/bindingConflicts.types";
import { normaliseStored } from "../../src/commands/chord";
import { availabilityContexts } from "../../src/commands/commandHelpers";
import { COMMAND_TABLE } from "../../src/commands/commandTable";
import type { CommandRow, OwnershipContext, Platform } from "../../src/commands/commandTable.types";
import { EDITOR_OWNED_CHORDS, keymapNameToStored } from "../../src/commands/editorOwnedChords";
import { RESERVED_CHORDS } from "../../src/commands/reservedChords";

export const TABLES: BindingTables = { rows: COMMAND_TABLE, reserved: RESERVED_CHORDS, inventory: EDITOR_OWNED_CHORDS };
export const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
export const VERSIONS: readonly number[] = [1, 2];
export const CONTEXTS: readonly OwnershipContext[] = [
  "editorW", "editorS", "tableW", "tableS", "modal", "recorder", "nativeFocus",
];
export const POOL: readonly string[] = [
  "Cmd+Z", "Cmd+Q", "Cmd+Shift+3", "Option+F4", "Cmd+D", "Cmd+Enter", "Cmd+K", "Cmd+N", "Cmd+Shift+T",
  "Cmd+Shift+S", "Cmd+J", "Cmd+Ctrl+N", "<unassigned>", "Cmd++", "Cmd+Y", "Cmd+Backspace", "F6", "F3", "Cmd+W",
];
export const CONFIG_ROWS: readonly CommandRow[] = COMMAND_TABLE.filter((r) => r.prefField !== undefined);
export const FIELDS: readonly string[] = CONFIG_ROWS.map((r) => String(r.prefField)).sort();

export interface SweepInput {
  readonly platform: Platform;
  readonly v: number;
  readonly stored: Readonly<Record<string, string>>;
}

/** Family (a): 58 fields × 19 values × 3 platforms × 2 versions = 6 612. */
export function singleCustomInputs(): SweepInput[] {
  const out: SweepInput[] = [];
  for (const platform of PLATFORMS)
    for (const v of VERSIONS)
      for (const field of FIELDS) for (const value of POOL) out.push({ platform, v, stored: { [field]: value } });
  return out;
}

const ver = (v: number) => (v >= 2 ? "v2" : "v1");
const rowOf = (field: string): CommandRow => {
  const row = CONFIG_ROWS.find((r) => r.prefField === field);
  if (row === undefined) throw new Error(`no row for ${field}`);
  return row;
};

/** The contexts a configurable row is available in, from the table data alone. */
export function availableContexts(field: string, p: Platform, v: number): OwnershipContext[] {
  const row = rowOf(field);
  const ctx = availabilityContexts(row.availability[p][ver(v)]);
  return row.contexts.filter((c) => ctx.includes(c));
}

const EXEMPT_OWNERS = new Set(
  EDITOR_OWNED_CHORDS.filter((r) => r.disposition.kind === "removeInM1b" || r.disposition.kind === "shadowed")
    .map((r) => `editor:${r.source}:${r.key}`),
);

/** Law 1 (at most one owner): every violation, as a readable line. */
export function lawOneViolations(input: SweepInput, res: Resolutions, owner: (c: OwnershipContext, k: string) => string | null): string[] {
  const out: string[] = [];
  for (const field of FIELDS) {
    const r = res[field];
    if (r?.kind !== "bound") continue;
    const row = rowOf(field);
    const stored = input.stored[field];
    const def = row.key[input.platform].defaults[ver(input.v)] ?? "";
    const atDefault =
      stored === undefined || normaliseStored(stored, input.platform) === normaliseStored(def, input.platform);
    for (const ctx of availableContexts(field, input.platform, input.v)) {
      const got = owner(ctx, r.chord);
      if (got === row.id) continue;
      if (atDefault && (input.v < 2 || (got !== null && EXEMPT_OWNERS.has(got)))) continue;
      out.push(`${input.platform}@${input.v} ${JSON.stringify(input.stored)}: ${field} ${r.chord} in ${ctx} → ${got}`);
    }
  }
  return out;
}

/** The fields bound, as `field=chord` lines. */
export const boundSet = (res: Resolutions): string[] =>
  Object.entries(res).flatMap(([f, r]) => (r.kind === "bound" ? [`${f}=${r.chord}`] : [])).sort();

/** The M1b rewrite: every `yieldedToCustom` row's stored value becomes `<unassigned>`. */
export function rewriteYields(stored: Readonly<Record<string, string>>, res: Resolutions): Record<string, string> {
  const out: Record<string, string> = { ...stored };
  for (const [f, r] of Object.entries(res)) if (r.kind === "suppressed" && r.reason === "yieldedToCustom") out[f] = "<unassigned>";
  return out;
}

/** Family (b): for every `implements(X)` row, X moved to Cmd+J and Save (New when X is Save) on X's chord. */
export function implementsInputs(): SweepInput[] {
  const out: SweepInput[] = [];
  for (const row of EDITOR_OWNED_CHORDS) {
    if (row.disposition.kind !== "implements") continue;
    const target = row.disposition.command;
    const field = CONFIG_ROWS.find((r) => r.id === target)?.prefField;
    const taker = target === "file.save" ? "fileNew" : "fileSave";
    for (const platform of row.platforms) {
      const chord = keymapNameToStored(row.key, platform);
      if (chord === null) continue;
      const stored: Record<string, string> = field === undefined ? {} : { [field]: "Cmd+J" };
      stored[taker] = chord;
      for (const v of VERSIONS) out.push({ platform, v, stored });
    }
  }
  return out;
}

export type Diffed = { readonly fields: Record<string, Resolution>; readonly owners: Record<string, (string | null)[]> };

export function diffAgainst(baseline: Resolutions, input: SweepInput, override?: Readonly<Record<string, string>>): Diffed {
  const state = resolveWith(TABLES, input.platform, input.v, input.stored, override as never);
  const fields: Record<string, Resolution> = {};
  for (const f of Object.keys(state.resolutions).sort()) {
    if (JSON.stringify(state.resolutions[f]) !== JSON.stringify(baseline[f])) fields[f] = state.resolutions[f];
  }
  const owners: Record<string, (string | null)[]> = {};
  for (const value of Object.values(input.stored).sort()) {
    if (normaliseStored(value, input.platform) !== null) owners[value] = CONTEXTS.map((c) => state.ownerOf(c, value));
  }
  return { fields, owners };
}
