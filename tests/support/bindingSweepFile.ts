/**
 * @module tests/support/bindingSweepFile
 * Purpose: builds and serialises the generated `sweep` section of
 * `tests/fixtures/binding-owner-cases.json` (matrix R1-3, kept in the shared
 * fixture rather than a separate file). Shape: `{$generated, pool, contexts,
 * baselines: {"<platform>@<v>": Resolutions}, entries: [{platforms, v,
 * stored, availabilityOverride?, diff: {fields, owners}}]}`. `diff.fields`
 * holds only the fields that differ from the baseline; `diff.owners` holds
 * `ownerOf` for each parseable stored value in every context. Entries whose
 * diff is the same at v1 and v2, or on several platforms, are collapsed.
 * One entry per line, LF. DOM-free.
 */
import { resolveWith } from "../../src/commands/bindingConflicts";
import type { Resolutions } from "../../src/commands/bindingConflicts.types";
import type { Platform } from "../../src/commands/commandTable.types";
import type { BindingCase } from "./bindingFixture";
import {
  CONTEXTS,
  POOL,
  PLATFORMS,
  TABLES,
  VERSIONS,
  diffAgainst,
  implementsInputs,
  singleCustomInputs,
  type SweepInput,
} from "./bindingSweep";

export const SWEEP_GENERATED =
  "Generated from src/commands/ by tests/binding-conflicts.test.ts; do not edit. " +
  "Regenerate: MDPRO_WRITE_BINDING_SWEEP=1 pnpm exec vitest run tests/binding-conflicts.test.ts";

const SWEEP_MARK = '\n  "sweep": ';

export function baselines(): Record<string, Resolutions> {
  const out: Record<string, Resolutions> = {};
  for (const p of PLATFORMS) for (const v of VERSIONS) out[`${p}@${v}`] = resolveWith(TABLES, p, v, {}).resolutions;
  return out;
}

interface Raw extends SweepInput {
  readonly availabilityOverride?: Readonly<Record<string, string>>;
}

/** Every input of families (a), (b) and (c), de-duplicated. */
function allInputs(cases: readonly BindingCase[]): Raw[] {
  const fromCases: Raw[] = cases
    .filter((c) => VERSIONS.includes(c.defaultsVersion))
    .map((c) => ({ platform: c.platform, v: c.defaultsVersion, stored: c.stored,
      ...(c.availabilityOverride ? { availabilityOverride: c.availabilityOverride } : {}) }));
  const seen = new Set<string>();
  const all: Raw[] = [...singleCustomInputs(), ...implementsInputs(), ...fromCases];
  return all.filter((i) => {
    const k = JSON.stringify([i.platform, i.v, i.stored, i.availabilityOverride ?? null]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface BuiltEntry {
  platforms: Platform[];
  v: number[];
  stored: Readonly<Record<string, string>>;
  availabilityOverride?: Readonly<Record<string, string>>;
  diff: unknown;
}

/** Build the sweep entries, collapsing equal diffs over versions, then platforms. */
export function buildEntries(cases: readonly BindingCase[]): BuiltEntry[] {
  const base = baselines();
  const byVersion = new Map<string, BuiltEntry>();
  for (const i of allInputs(cases)) {
    const diff = diffAgainst(base[`${i.platform}@${i.v}`] ?? {}, i, i.availabilityOverride);
    const input = JSON.stringify([i.stored, i.availabilityOverride ?? null]);
    const key = JSON.stringify([i.platform, input, diff]);
    const hit = byVersion.get(key);
    if (hit) hit.v.push(i.v);
    else
      byVersion.set(key, { platforms: [i.platform], v: [i.v], stored: i.stored, diff,
        ...(i.availabilityOverride ? { availabilityOverride: i.availabilityOverride } : {}) });
  }
  const byPlatform = new Map<string, BuiltEntry>();
  for (const e of byVersion.values()) {
    const key = JSON.stringify([e.v, e.stored, e.availabilityOverride ?? null, e.diff]);
    const hit = byPlatform.get(key);
    if (hit) hit.platforms.push(...e.platforms);
    else byPlatform.set(key, e);
  }
  return [...byPlatform.values()];
}

function entryLine(e: BuiltEntry): string {
  return JSON.stringify({
    platforms: e.platforms, v: e.v, stored: e.stored,
    ...(e.availabilityOverride ? { availabilityOverride: e.availabilityOverride } : {}), diff: e.diff,
  });
}

/** The sweep section as it sits at the end of the fixture, from `\n  "sweep": ` to EOF. */
export function serializeSweepTail(cases: readonly BindingCase[]): string {
  const base = baselines();
  const lines = [
    "{",
    `    "$generated": ${JSON.stringify(SWEEP_GENERATED)},`,
    `    "pool": ${JSON.stringify(POOL)},`,
    `    "contexts": ${JSON.stringify(CONTEXTS)},`,
    '    "baselines": {',
    Object.entries(base).map(([k, m]) => `      ${JSON.stringify(k)}: ${JSON.stringify(m)}`).join(",\n"),
    "    },",
    '    "entries": [',
    buildEntries(cases).map((e) => `      ${entryLine(e)}`).join(",\n"),
    "    ]",
    "  }",
  ];
  return `${SWEEP_MARK}${lines.join("\n")}\n}\n`;
}

/** The committed tail from the sweep mark, or `null` when the fixture has none. */
export function committedSweepTail(text: string): string | null {
  const at = text.lastIndexOf(SWEEP_MARK);
  return at < 0 ? null : text.slice(at);
}

/** The fixture text with its sweep section replaced (or appended). */
export function withSweep(text: string, tail: string): string {
  const at = text.lastIndexOf(SWEEP_MARK);
  if (at >= 0) return text.slice(0, at) + tail;
  const end = text.lastIndexOf("\n}\n");
  return `${text.slice(0, end)},${tail}`;
}
