/**
 * Purpose: the editor-owned chord inventory (plan M1A-WI-6, ADR-0114 K4): one
 * row per chord a loaded editor keymap binds today, in WYSIWYG (`W`, Milkdown)
 * or Source (`S`, CodeMirror), with what M1b does about it. Data only; in M1a
 * production reads it only through Settings' conflict check (M1A-WI-10).
 * Tests hold it in two-way bijection
 * with the composed keymaps.
 *
 * @coordinates-with src/commands/chord.ts — chords are compared in normal form
 * @coordinates-with src/commands/inventory/*.ts — the rows, one file per editor
 */
import { normaliseStored } from "./chord";
import type { CommandId, OwnershipContext, Platform } from "./commandTable.types";
import { CODEMIRROR_ROWS } from "./inventory/codemirrorRows";
import { MILKDOWN_ROWS } from "./inventory/milkdownRows";

export type InventoryEditor = "W" | "S";

/** The defect or plan clause that removes or rebinds a row in M1b. */
export type RemovalId = "C11" | "C12" | "C17" | "D264" | "D269" | "D271" | "D272" | "K4";

/** A registered defect whose collision is not live on v2 (matrix SD16). */
export type LatentId = "D267" | "D268" | "D270";

export type Disposition =
  | { readonly kind: "implements"; readonly command: CommandId }
  | { readonly kind: "editorOwned" }
  | { readonly kind: "removeInM1b"; readonly id: RemovalId }
  | { readonly kind: "shadowed"; readonly by: string };

export interface EditorOwnedRow {
  readonly editor: InventoryEditor;
  /** e.g. `codemirror:defaultKeymap`, `milkdown:preset-gfm/tableKeymap`. */
  readonly source: string;
  /** The keymap name as the source writes it on these platforms. */
  readonly key: string;
  readonly platforms: readonly Platform[];
  readonly contexts: readonly OwnershipContext[];
  readonly disposition: Disposition;
  /** Only on `editorOwned` rows. */
  readonly latent?: LatentId;
  /** Library-side entry names, for sources that name their entries. */
  readonly names?: readonly string[];
}

/** Keymap modifier names → stored tokens. `Cmd` / `Meta` is ⌘ on macOS and the Win key elsewhere. */
const MODIFIER_NAMES: Readonly<Record<string, string>> = {
  Mod: "Cmd", Cmd: "Meta", Meta: "Meta", Ctrl: "Ctrl", Control: "Ctrl", Alt: "Option", Shift: "Shift",
};

/**
 * A CodeMirror / ProseMirror keymap name (`Mod-Shift-l`, `Shift-Mod-k`, `Mod--`)
 * in stored syntax for `platform`, normalised; `null` when the stored grammar
 * cannot name it (a bare key, an unknown modifier, the Win key off-Mac).
 * An uppercase letter key implies Shift, as both editors match it (`Alt-A`).
 */
export function keymapNameToStored(name: string, platform: Platform): string | null {
  if (name === "") return null;
  const parts = name.split(/-(?!$)/);
  let key = parts.pop() ?? "";
  const mods: string[] = [];
  for (const m of parts) {
    const token = MODIFIER_NAMES[m];
    if (token === undefined) return null;
    if (token !== "Meta") mods.push(token);
    else if (platform === "macos") mods.push("Cmd");
    else return null;
  }
  if (/^[A-Z]$/.test(key) && !mods.includes("Shift")) mods.push("Shift");
  if (key === " ") key = "Space";
  return normaliseStored([...mods, key].join("+"), platform);
}

export const EDITOR_OWNED_CHORDS: readonly EditorOwnedRow[] = [...CODEMIRROR_ROWS, ...MILKDOWN_ROWS];
