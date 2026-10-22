/**
 * @module tests/support/tableBindings
 * Purpose: oracles over the command table and the editor-owned inventory for
 * M1A-WI-6 (K5, one owner per platform × context × chord, the v2 × inventory
 * cross-check). Written from the matrix, not from the modules under test: it
 * reads their data and decides the law here. DOM-free.
 */
import { normaliseStored } from "../../src/commands/chord";
import { COMMAND_TABLE } from "../../src/commands/commandTable";
import type { CommandRow, OwnershipContext, Platform } from "../../src/commands/commandTable.types";
import {
  keymapNameToStored,
  type EditorOwnedRow,
  type LatentId,
} from "../../src/commands/editorOwnedChords";

export const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux"];
export const CONTEXTS: readonly OwnershipContext[] = [
  "editorW", "editorS", "tableW", "tableS", "modal", "recorder", "nativeFocus",
];
export type Version = "v1" | "v2";

/** The field each latent defect waits on (matrix R2-D, R3-2). */
export const LATENT_FIELD: Readonly<Record<LatentId, string>> = {
  D267: "paragraphCodeFences",
};

export interface TableBinding {
  readonly row: CommandRow;
  readonly chord: string;
  readonly kind: "primary" | "secondary";
  /** The row works in this version on this platform. */
  readonly available: boolean;
}

/** Every bound chord of every table row (sentinels and `null` keys bind nothing). */
export function tableBindings(version: Version, p: Platform): TableBinding[] {
  const out: TableBinding[] = [];
  for (const row of COMMAND_TABLE) {
    const spec = row.key[p];
    const available = row.availability[p][version] !== "none";
    const primary = spec.defaults[version];
    const add = (s: string | null, kind: TableBinding["kind"]) => {
      const chord = s === null ? null : normaliseStored(s, p);
      if (chord !== null) out.push({ row, chord, kind, available });
    };
    add(primary, "primary");
    for (const s of spec.secondaries[version]) add(s, "secondary");
  }
  return out;
}

export interface Duplicate {
  readonly platform: Platform;
  readonly chord: string;
  readonly ids: readonly string[];
}

/** Chords two or more rows bind in a shared context, per platform. */
export function oneOwnerViolations(version: Version): { dups: Duplicate[]; pairs: number } {
  const seen = new Map<string, Duplicate>();
  let pairs = 0;
  for (const p of PLATFORMS) {
    for (const ctx of CONTEXTS) {
      const byChord = new Map<string, Set<string>>();
      for (const b of tableBindings(version, p)) {
        if (!b.row.contexts.includes(ctx)) continue;
        pairs++;
        const ids = byChord.get(b.chord) ?? new Set<string>();
        ids.add(b.row.id);
        byChord.set(b.chord, ids);
      }
      for (const [chord, ids] of byChord) {
        if (ids.size < 2) continue;
        const sorted = [...ids].sort();
        seen.set(`${p}|${chord}|${sorted.join(",")}`, { platform: p, chord, ids: sorted });
      }
    }
  }
  return { dups: [...seen.values()], pairs };
}

export interface Collision {
  readonly platform: Platform;
  readonly chord: string;
  readonly rowId: string;
  readonly owner: string;
  readonly row: EditorOwnedRow;
  readonly binding: TableBinding;
}

export const ownerId = (r: EditorOwnedRow): string => `editor:${r.source}:${r.key}`;

/** A collision is live only when the command's v1 key owns this chord today. */
export function isLiveCollision(c: Collision): boolean {
  const row = c.binding.row;
  const key = row.key[c.platform].defaults.v1;
  return row.availability[c.platform].v1 !== "none"
    && key !== null && normaliseStored(key, c.platform) === c.chord;
}

/** Inventory × table collisions: equal chord on a platform, intersecting contexts. */
export function collisions(version: Version, inventory: readonly EditorOwnedRow[]): Collision[] {
  const out = new Map<string, Collision>();
  for (const p of PLATFORMS) {
    const bindings = tableBindings(version, p);
    for (const r of inventory) {
      if (!r.platforms.includes(p)) continue;
      const chord = keymapNameToStored(r.key, p);
      if (chord === null) continue;
      for (const b of bindings) {
        if (b.chord !== chord || !b.row.contexts.some((c) => r.contexts.includes(c))) continue;
        const c = { platform: p, chord, rowId: b.row.id, owner: ownerId(r), row: r, binding: b };
        out.set(`${p}|${chord}|${b.row.id}|${c.owner}`, c);
      }
    }
  }
  return [...out.values()];
}

/** Why a collision is allowed, or `null` when nothing explains it (matrix law). */
export function explanation(c: Collision): string | null {
  const d = c.row.disposition;
  switch (d.kind) {
    case "implements":
      return d.command === c.rowId ? "implements" : null;
    case "removeInM1b":
      return `removeInM1b(${d.id})`;
    case "shadowed":
      return `shadowed(${d.by})`;
    case "editorOwned": {
      const latent = c.row.latent;
      if (latent === undefined || c.binding.row.prefField !== LATENT_FIELD[latent]) return null;
      if (isLiveCollision(c)) return null;
      return c.binding.available ? `latent(${latent}:M1b)` : `latent(${latent})`;
    }
  }
}

export const describe1 = (c: Collision): string =>
  `${c.platform} ${c.chord}: ${c.rowId} vs ${c.owner} [${c.row.platforms.join(",")}]`;
