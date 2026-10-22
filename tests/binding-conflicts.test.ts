// @vitest-environment node
/**
 * M1A-WI-8 — the binding conflict filter (`src/commands/bindingConflicts.ts`).
 * Matrix: `.claude/tdd-guardian/tests-20261016-223726.md` § M1A-WI-8, SD4–SD16,
 * R1-3, R1-13, R3-1. The Rust twin (`src-tauri/src/services/binding_conflicts_tests.rs`)
 * runs the same `cases` and replays the generated `sweep` of
 * `tests/fixtures/binding-owner-cases.json`.
 *
 * Laws: at most one owner, unassign/rewrite exhaustive sweeps in the slow
 * sibling; fixture-scale representatives here;
 * input and table order change nothing; locality against all-defaults.
 *
 * Sweep regeneration: MDPRO_WRITE_BINDING_SWEEP=1 pnpm exec vitest run tests/binding-conflicts.test.ts
 *
 * Mocked: nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ownerOf, resolveBindings, resolveWith } from "../src/commands/bindingConflicts";
import type { BindingTables, Resolutions } from "../src/commands/bindingConflicts.types";
import { normaliseStored } from "../src/commands/chord";
import { rowByPrefField } from "../src/commands/commandTable";
import type { OwnershipContext, Platform } from "../src/commands/commandTable.types";
import { type BindingCase, loadBindingFixture, rawCaseAssertionCount } from "./support/bindingFixture";
import {
  CONTEXTS, FIELDS, PLATFORMS, TABLES, VERSIONS, boundSet, lawOneViolations, rewriteYields,
  singleCustomInputs,
} from "./support/bindingSweep";
import { committedSweepTail, serializeSweepTail, withSweep } from "./support/bindingSweepFile";
import { V2_DEFAULTS, V2_UNAVAILABLE } from "./support/bindingV2Defaults";
import { collectionCases } from "./support/collectionCases";

const FIXTURE_PATH = resolve(__dirname, "fixtures/binding-owner-cases.json");
const TEXT = readFileSync(FIXTURE_PATH, "utf8");
const RAW: unknown = JSON.parse(TEXT);
const { cases: CASES } = loadBindingFixture(RAW);
const ver = (v: number) => (v >= 2 ? "v2" : "v1");
const REASONS = ["fixed", "native", "reserved", "editorOwned", "customDuplicate", "yieldedToCustom", "unavailable", "unparseable", "physicalOverlap"];

const stateOf = (c: BindingCase, tables: BindingTables = TABLES) =>
  resolveWith(tables, c.platform, c.defaultsVersion, c.stored, c.availabilityOverride ?? {});

describe("fixture loader (R1-13a)", () => {
  it("loads the committed fixture and rejects three mutated copies", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(46);
    const mutate = (f: (top: { cases: Record<string, unknown>[] }) => void) => {
      const copy = JSON.parse(TEXT) as { cases: Record<string, unknown>[] };
      f(copy);
      return () => loadBindingFixture(copy);
    };
    expect(mutate((t) => { t.cases[0]!.extra = 1; })).toThrow(/unknown key extra/);
    expect(mutate((t) => { (t.cases[0]!.expect as Record<string, Record<string, unknown>>).fileSave!.x = 1; })).toThrow(/unknown key x/);
    expect(mutate((t) => { t.cases[0]!.expcet = t.cases[0]!.expect; delete t.cases[0]!.expect; })).toThrow(/expcet/);
  });
});

describe("fixture guards", () => {
  it("has at least 46 cases, all three platforms and all 8 reasons", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(46);
    expect(new Set(CASES.map((c) => c.platform))).toEqual(new Set(PLATFORMS));
    const reasons = new Set(CASES.flatMap((c) => Object.values(c.expect)).flatMap((r) => (r.kind === "suppressed" ? [r.reason] : [])));
    expect([...reasons].sort()).toEqual([...REASONS].sort());
  });
});

let executed = 0;
const normDefault = (field: string, p: Platform, v: number): string | null => {
  const d = rowByPrefField(field as never)?.key[p].defaults[ver(v)];
  return typeof d === "string" ? normaliseStored(d, p) : null;
};

describe("shared cases (TS side)", () => {
  it.each(collectionCases("tests/binding-conflicts.test.ts:73", CASES.map((c) => [c.name, c] as const)))("%s", (_name, c) => {
    const state = stateOf(c);
    for (const [field, want] of Object.entries(c.expect)) {
      expect({ field, got: state.resolutions[field] }).toEqual({ field, got: want });
      executed++;
    }
    for (const o of c.owners) {
      expect({ ...o, owner: state.ownerOf(o.context, o.chord) }).toEqual(o);
      executed++;
    }
    const baseline = resolveBindings(c.platform, c.defaultsVersion, {});
    const mentioned = new Set(Object.values(c.stored).map((s) => normaliseStored(s, c.platform)));
    const local = FIELDS.filter((f) => !(f in c.stored) && !(f in (c.availabilityOverride ?? {})) && !mentioned.has(normDefault(f, c.platform, c.defaultsVersion)));
    expect(local.length).toBeGreaterThan(40);
    expect(Object.fromEntries(local.map((f) => [f, state.resolutions[f]]))).toEqual(Object.fromEntries(local.map((f) => [f, baseline[f]])));
    executed++;
  });

  it("executed exactly the assertion count computed from the raw JSON (R1-13b)", () => {
    expect(executed).toBe(rawCaseAssertionCount(RAW));
  });

  it("the convenience ownerOf agrees with the state on every owners row", () => {
    for (const c of CASES.filter((x) => x.availabilityOverride === undefined)) {
      for (const o of c.owners) expect(ownerOf(c.platform, c.defaultsVersion, c.stored, o.context, o.chord)).toBe(o.owner);
    }
  });
});

describe("baseline ownership of the probe chords (stored = {})", () => {
  const owners = (p: Platform, v: number, chord: string) => {
    const s = resolveWith(TABLES, p, v, {});
    return CONTEXTS.map((ctx) => s.ownerOf(ctx, chord));
  };
  const n = null;
  it.each([
    ["macos", 1, "Cmd+J", [n, n, n, n, n, n, n]],
    ["macos", 2, "Cmd+J", [n, n, n, n, n, n, n]],
    ["macos", 2, "Cmd+Option+G", [n, "editor:codemirror:searchKeymap:Mod-Alt-g", n, "editor:codemirror:searchKeymap:Mod-Alt-g", n, n, n]],
    ["macos", 2, "Cmd+Enter", ["editor:milkdown:core/baseKeymap:Mod-Enter", "editor:codemirror:defaultKeymap:Mod-Enter",
      "editor:milkdown:core/baseKeymap:Mod-Enter", "editor:codemirror:defaultKeymap:Mod-Enter", n, n, n]],
    ["macos", 2, "Ctrl+E", ["editor:milkdown:core/baseKeymap:Ctrl-e", "editor:codemirror:defaultKeymap:Ctrl-e",
      "editor:milkdown:core/baseKeymap:Ctrl-e", "editor:codemirror:defaultKeymap:Ctrl-e", n, n, n]],
    ["linux", 2, "Option+D", [n, n, n, n, n, n, n]],
  ] as const)("%s v%s %s", (p, v, chord, want) => {
    expect(owners(p, v, chord)).toEqual(want);
  });
});

describe("all defaults at v2, every platform", () => {
  it.each(collectionCases("tests/binding-conflicts.test.ts:123", PLATFORMS))("%s: defaults bound, sentinels as such, unavailable rows reserve; nothing flagged", (p) => {
    const res = resolveBindings(p, 2, {});
    expect(Object.keys(res).sort()).toEqual([...Object.keys(V2_DEFAULTS)].sort());
    for (const [field, [mac, off]] of Object.entries(V2_DEFAULTS)) {
      const d = p === "macos" ? mac : off;
      const want =
        d === "<unassigned>" ? { kind: "unassigned" }
        : d === "<system>" ? { kind: "system" }
        : V2_UNAVAILABLE.includes(field) ? { kind: "suppressed", reason: "unavailable", conflictsWith: [], flagged: false }
        : { kind: "bound", chord: normaliseStored(d, p) };
      expect({ field, r: res[field] }).toEqual({ field, r: want });
    }
  });
});

describe("law 1–3 fixture-scale representatives (S4/S5/S6)", () => {
  it("one custom binding has at most one owner", () => {
    const input = { platform: "macos" as const, v: 1, stored: { fileSave: "Cmd+J" } };
    const state = resolveWith(TABLES, input.platform, input.v, input.stored);
    expect(lawOneViolations(input, state.resolutions, (c, k) => state.ownerOf(c, k))).toEqual([]);
  });

  it("unassigning New leaves a separately bound Save unchanged", () => {
    const stored = { fileSave: "Cmd+J" };
    const before = resolveBindings("macos", 1, stored);
    const after = resolveBindings("macos", 1, { ...stored, fileNew: "<unassigned>" });
    expect(before.fileSave).toMatchObject({ kind: "bound", chord: "Cmd+J" });
    expect(after.fileSave).toEqual(before.fileSave);
  });

  it("rewriting one yield is idempotent and preserves the bound set", () => {
    const stored = { fileSave: "Cmd+N" };
    const before = resolveBindings("macos", 1, stored);
    const once = rewriteYields(stored, before);
    const after = resolveBindings("macos", 1, once);
    expect(Object.values(before).some((r) => r.kind === "suppressed" && r.reason === "yieldedToCustom")).toBe(true);
    expect(once).not.toEqual(stored);
    expect(boundSet(after)).toEqual(boundSet(before));
    expect(rewriteYields(once, after)).toEqual(once);
  });
});

const reversedTables = (): BindingTables => ({
  rows: [...TABLES.rows].reverse(),
  inventory: [...TABLES.inventory].reverse(),
  reserved: {
    macos: [...TABLES.reserved.macos].reverse(),
    windows: [...TABLES.reserved.windows].reverse(),
    linux: [...TABLES.reserved.linux].reverse(),
  },
});

describe("law 4: order independence (S6) and R3-1", () => {
  it("reversing the stored map or the tables changes no resolution and no owner", () => {
    const rev = reversedTables();
    const sweep = singleCustomInputs().filter((_, k) => k % 33 === 0).slice(0, 200);
    expect(sweep.length).toBe(200);
    const inputs = [
      ...CASES.map((c) => ({ c, owners: c.owners.map((o) => [o.context, o.chord] as const) })),
      ...sweep.map((i) => ({
        c: { name: "", platform: i.platform, defaultsVersion: i.v, stored: i.stored, expect: {}, owners: [] } as BindingCase,
        owners: CONTEXTS.map((ctx) => [ctx, Object.values(i.stored)[0] ?? ""] as const),
      })),
    ];
    for (const { c, owners } of inputs) {
      const a = stateOf(c);
      const reversedStored = { ...c, stored: Object.fromEntries(Object.entries(c.stored).reverse()) };
      for (const b of [stateOf(reversedStored), stateOf(c, rev)]) {
        expect(JSON.stringify(b.resolutions, Object.keys(b.resolutions).sort())).toBe(JSON.stringify(a.resolutions, Object.keys(a.resolutions).sort()));
        expect(b.resolutions).toEqual(a.resolutions);
        for (const [ctx, chord] of owners) expect(b.ownerOf(ctx as OwnershipContext, chord)).toBe(a.ownerOf(ctx as OwnershipContext, chord));
      }
    }
    const c09 = CASES.find((c) => c.name.startsWith("C09"));
    expect(c09 && stateOf(c09, rev).ownerOf("tableW", "Cmd+Enter")).toBe("editor:milkdown:core/baseKeymap:Mod-Enter");
  });
});

describe("version guard (S3)", () => {
  it.each([Number.NaN, -1, 1.5, 0])("version %s resolves as v1 and does not throw", (v) => {
    for (const p of PLATFORMS) {
      for (const stored of [{}, { fileSave: "Cmd+Shift+T" }, { fileNew: "Cmd+Ctrl+N" }]) {
        expect(resolveBindings(p, v, stored)).toEqual(resolveBindings(p, 1, stored));
      }
    }
  });
});

describe("sweep section (R1-3a)", () => {
  const built = serializeSweepTail(CASES);
  if (process.env.MDPRO_WRITE_BINDING_SWEEP === "1") writeFileSync(FIXTURE_PATH, withSweep(TEXT, built));
  const text = readFileSync(FIXTURE_PATH, "utf8");

  it("the in-memory build equals the committed bytes, LF, one trailing newline, at most 1 MiB", () => {
    expect(committedSweepTail(text)).toBe(built);
    expect(text.includes("\r")).toBe(false);
    expect(text.endsWith("}\n") && !text.endsWith("\n\n")).toBe(true);
    expect(Buffer.byteLength(built)).toBeLessThanOrEqual(1024 * 1024);
  });

  it("has every family: ≥ 6 612 single-custom inputs folded in, and 6 baselines", () => {
    const sweep = loadBindingFixture(JSON.parse(text)).sweep;
    expect(Object.keys(sweep?.baselines ?? {}).sort()).toEqual(PLATFORMS.flatMap((p) => VERSIONS.map((v) => `${p}@${v}`)).sort());
    const expanded = (sweep?.entries ?? []).reduce((n, e) => n + e.platforms.length * e.v.length, 0);
    expect(expanded).toBeGreaterThanOrEqual(6612 + CASES.length);
    const baselines: Record<string, Resolutions> = {};
    for (const p of PLATFORMS) for (const v of VERSIONS) baselines[`${p}@${v}`] = resolveBindings(p, v, {});
    expect(sweep?.baselines).toEqual(baselines);
  });
});
