/**
 * Purpose: build `src-tauri/src/menu_layout.json` (plan M1A-WI-7) from the
 * command table, the reserved chords and the editor-owned inventory, so the
 * Rust side reads one generated copy instead of keeping a second one by hand.
 * Pure; the only writer is tests/menu-layout-freshness.test.ts.
 *
 * Output is independent of input order:
 * - rows sorted by `id`;
 * - reserved chords sorted per platform;
 * - inventory rows sorted by editor, source, key, platforms, then the row's
 *   own JSON;
 * - every object's keys in a fixed order, written out below;
 * - all comparisons by UTF-16 code unit, never locale.
 * Arrays inside a row (menu path, contexts, platforms, secondaries, names)
 * keep their order: it is data.
 *
 * @coordinates-with src-tauri/src/menu_layout.rs — the serde reader
 * @coordinates-with tests/menu-layout-freshness.test.ts — writes and checks the file
 * @coordinates-with tests/support/decodeMenuLayout.ts — the test-side inverse
 */
import { assertNever } from "./assertNever";
import type { CommandRow, KeySpec, PerPlatform, Versioned } from "./commandTable.types";
import type { Disposition, EditorOwnedRow } from "./editorOwnedChords";

export const MENU_LAYOUT_GENERATED =
  "Generated from src/commands/ by tests/menu-layout-freshness.test.ts; do not edit. " +
  "Regenerate: MDPRO_WRITE_MENU_LAYOUT=1 pnpm exec vitest run tests/menu-layout-freshness.test.ts";

export interface MenuLayout {
  readonly $generated: string;
  readonly rows: readonly CommandRow[];
  readonly reserved: PerPlatform<readonly string[]>;
  readonly editorOwned: readonly EditorOwnedRow[];
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareKeys(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const c = byCodeUnit(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}

const perPlatform = <T, U>(p: PerPlatform<T>, f: (v: T) => U): PerPlatform<U> => ({
  macos: f(p.macos),
  windows: f(p.windows),
  linux: f(p.linux),
});

const versioned = <T, U>(v: Versioned<T>, f: (x: T) => U): Versioned<U> => ({ v1: f(v.v1), v2: f(v.v2) });

function keySpec(k: KeySpec): KeySpec {
  const secondaries = versioned(k.secondaries, (s) => [...s]);
  // Two arms so each keeps its own `defaults` type (string vs string | null).
  return k.kind === "configurable"
    ? { kind: k.kind, defaults: versioned(k.defaults, (d) => d), secondaries }
    : { kind: k.kind, defaults: versioned(k.defaults, (d) => d), secondaries };
}

function commandRow(r: CommandRow): CommandRow {
  return {
    id: r.id,
    ...(r.prefField === undefined ? {} : { prefField: r.prefField }),
    ...(r.menuId === undefined ? {} : { menuId: r.menuId }),
    menu: perPlatform(r.menu, (m) => (m === "none" ? m : [...m])),
    key: perPlatform(r.key, keySpec),
    contexts: [...r.contexts],
    availability: perPlatform(r.availability, (a) => versioned(a, (x) => x)),
    route: perPlatform(r.route, (x) => x),
    ...(r.nativeBehaviour === undefined ? {} : { nativeBehaviour: r.nativeBehaviour }),
  };
}

function disposition(d: Disposition): Disposition {
  switch (d.kind) {
    case "implements":
      return { kind: d.kind, command: d.command };
    case "editorOwned":
      return { kind: d.kind };
    case "removeInM1b":
      return { kind: d.kind, id: d.id };
    case "shadowed":
      return { kind: d.kind, by: d.by };
  }
  return assertNever(d);
}

function inventoryRow(r: EditorOwnedRow): EditorOwnedRow {
  return {
    editor: r.editor,
    source: r.source,
    key: r.key,
    platforms: [...r.platforms],
    contexts: [...r.contexts],
    disposition: disposition(r.disposition),
    ...(r.latent === undefined ? {} : { latent: r.latent }),
    ...(r.names === undefined ? {} : { names: [...r.names] }),
  };
}

const inventorySortKey = (r: EditorOwnedRow): string[] => [
  r.editor, r.source, r.key, r.platforms.join(","), JSON.stringify(r),
];

export function buildMenuLayout(
  table: readonly CommandRow[],
  reserved: PerPlatform<readonly string[]>,
  editorOwned: readonly EditorOwnedRow[],
): MenuLayout {
  return {
    $generated: MENU_LAYOUT_GENERATED,
    rows: table.map(commandRow).sort((a, b) => byCodeUnit(a.id, b.id)),
    reserved: perPlatform(reserved, (list) => [...list].sort(byCodeUnit)),
    editorOwned: editorOwned
      .map(inventoryRow)
      .sort((a, b) => compareKeys(inventorySortKey(a), inventorySortKey(b))),
  };
}

/** 2-space JSON, LF only, one trailing newline. */
export function serializeMenuLayout(layout: MenuLayout): string {
  return `${JSON.stringify(layout, null, 2)}\n`;
}
