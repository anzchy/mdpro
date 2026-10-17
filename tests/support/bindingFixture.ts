/**
 * @module tests/support/bindingFixture
 * Purpose: the strict TS loader of the M1A-WI-8 `cases` and `sweep` sections of
 * `tests/fixtures/binding-owner-cases.json` (matrix R1-13a): every object is
 * checked against a literal allow-list of keys, so an extra or misspelt key
 * fails instead of being skipped. The Rust twin is `deny_unknown_fields` in
 * `src-tauri/src/services/binding_conflicts_tests.rs`. Also computes the
 * R1-13b executed-assertion count from the raw JSON. DOM-free.
 */
import type { Availability, OwnershipContext, Platform } from "../../src/commands/commandTable.types";
import type { Resolution } from "../../src/commands/bindingConflicts.types";

export interface OwnerRow {
  readonly context: OwnershipContext;
  readonly chord: string;
  readonly owner: string | null;
}

export interface BindingCase {
  readonly name: string;
  readonly platform: Platform;
  readonly defaultsVersion: number;
  readonly availabilityOverride?: Readonly<Record<string, Availability>>;
  readonly stored: Readonly<Record<string, string>>;
  readonly expect: Readonly<Record<string, Resolution>>;
  readonly owners: readonly OwnerRow[];
}

export interface SweepDiff {
  readonly fields: Readonly<Record<string, Resolution>>;
  /** Stored value → `ownerOf` in each of `contexts`, in order. */
  readonly owners: Readonly<Record<string, readonly (string | null)[]>>;
}

export interface SweepEntry {
  readonly platforms: readonly Platform[];
  readonly v: readonly number[];
  readonly stored: Readonly<Record<string, string>>;
  readonly availabilityOverride?: Readonly<Record<string, Availability>>;
  readonly diff: SweepDiff;
}

export interface Sweep {
  readonly $generated: string;
  readonly pool: readonly string[];
  readonly contexts: readonly OwnershipContext[];
  readonly baselines: Readonly<Record<string, Readonly<Record<string, Resolution>>>>;
  readonly entries: readonly SweepEntry[];
}

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${where}: not an object`);
  return v as Obj;
}

function keys(o: Obj, required: readonly string[], optional: readonly string[], where: string): void {
  for (const k of Object.keys(o)) {
    if (!required.includes(k) && !optional.includes(k)) throw new Error(`${where}: unknown key ${k}`);
  }
  for (const k of required) if (!(k in o)) throw new Error(`${where}: missing key ${k}`);
}

const RESOLUTION_KEYS: Readonly<Record<string, readonly string[]>> = {
  bound: ["kind", "chord"],
  unassigned: ["kind"],
  system: ["kind"],
  suppressed: ["kind", "reason", "conflictsWith", "flagged"],
};

function resolution(v: unknown, where: string): Resolution {
  const o = obj(v, where);
  const allowed = RESOLUTION_KEYS[String(o.kind)];
  if (allowed === undefined) throw new Error(`${where}: unknown kind ${String(o.kind)}`);
  keys(o, allowed, [], where);
  return o as unknown as Resolution;
}

function resolutionMap(v: unknown, where: string): Record<string, Resolution> {
  const o = obj(v, where);
  return Object.fromEntries(Object.entries(o).map(([k, r]) => [k, resolution(r, `${where}.${k}`)]));
}

function strictCase(v: unknown, i: number): BindingCase {
  const where = `cases[${i}]`;
  const o = obj(v, where);
  keys(o, ["name", "platform", "defaultsVersion", "stored", "expect", "owners"], ["availabilityOverride"], where);
  resolutionMap(o.expect, `${where}.expect`);
  if (!Array.isArray(o.owners)) throw new Error(`${where}.owners: not an array`);
  o.owners.forEach((r, j) => keys(obj(r, `${where}.owners[${j}]`), ["context", "chord", "owner"], [], `${where}.owners[${j}]`));
  return o as unknown as BindingCase;
}

function strictSweep(v: unknown): Sweep {
  const o = obj(v, "sweep");
  keys(o, ["$generated", "pool", "contexts", "baselines", "entries"], [], "sweep");
  for (const [k, m] of Object.entries(obj(o.baselines, "sweep.baselines"))) resolutionMap(m, `sweep.baselines.${k}`);
  if (!Array.isArray(o.entries)) throw new Error("sweep.entries: not an array");
  o.entries.forEach((e, i) => {
    const where = `sweep.entries[${i}]`;
    const eo = obj(e, where);
    keys(eo, ["platforms", "v", "stored", "diff"], ["availabilityOverride"], where);
    const d = obj(eo.diff, `${where}.diff`);
    keys(d, ["fields", "owners"], [], `${where}.diff`);
    resolutionMap(d.fields, `${where}.diff.fields`);
  });
  return o as unknown as Sweep;
}

export interface BindingFixture {
  readonly cases: readonly BindingCase[];
  readonly sweep: Sweep | undefined;
}

/** Load the WI-8 sections strictly; throws on any unknown or missing key. */
export function loadBindingFixture(raw: unknown): BindingFixture {
  const top = obj(raw, "top level");
  keys(top, ["parse", "cases"], ["$comment", "sweep"], "top level");
  if (!Array.isArray(top.cases)) throw new Error("cases: not an array");
  return {
    cases: top.cases.map(strictCase),
    sweep: top.sweep === undefined ? undefined : strictSweep(top.sweep),
  };
}

/** R1-13b: Σ over cases of (expect keys + owners + 1 locality check), from the raw JSON. */
export function rawCaseAssertionCount(raw: unknown): number {
  const cases = (raw as { cases: { expect: object; owners: unknown[] }[] }).cases;
  return cases.reduce((n, c) => n + Object.keys(c.expect).length + c.owners.length + 1, 0);
}
