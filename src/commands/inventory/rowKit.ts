/**
 * Purpose: compact constructors for editor-owned inventory rows, so each
 * inventory file states only the source, key, platforms and disposition.
 * Contexts follow the editor: Source rows act in `editorS` / `tableS`,
 * WYSIWYG rows in `editorW` / `tableW`, and handlers that act only inside a
 * table (prosemirror-tables, gfm's tableKeymap) in `tableW` alone.
 *
 * @coordinates-with src/commands/editorOwnedChords.ts — the row type
 */
import type { CommandId, OwnershipContext, Platform } from "../commandTable.types";
import type {
  Disposition,
  EditorOwnedRow,
  InventoryEditor,
  LatentId,
  RemovalId,
} from "../editorOwnedChords";

export const ALL: readonly Platform[] = ["macos", "windows", "linux"];
export const MAC: readonly Platform[] = ["macos"];
export const OFF: readonly Platform[] = ["windows", "linux"];
export const LINUX: readonly Platform[] = ["linux"];

const S_CONTEXTS: readonly OwnershipContext[] = ["editorS", "tableS"];
const W_CONTEXTS: readonly OwnershipContext[] = ["editorW", "tableW"];
export const TABLE_W: readonly OwnershipContext[] = ["tableW"];

export const impl = (command: CommandId): Disposition => ({ kind: "implements", command });
export const owned: Disposition = { kind: "editorOwned" };
export const remove = (id: RemovalId): Disposition => ({ kind: "removeInM1b", id });
export const shadowedBy = (by: string): Disposition => ({ kind: "shadowed", by });

export interface RowOptions {
  readonly platforms?: readonly Platform[];
  readonly latent?: LatentId;
  readonly names?: readonly string[];
  readonly contexts?: readonly OwnershipContext[];
}

export function row(
  editor: InventoryEditor,
  source: string,
  key: string,
  disposition: Disposition,
  opts: RowOptions = {},
): EditorOwnedRow {
  return {
    editor,
    source,
    key,
    platforms: opts.platforms ?? ALL,
    contexts: opts.contexts ?? (editor === "S" ? S_CONTEXTS : W_CONTEXTS),
    disposition,
    ...(opts.latent === undefined ? {} : { latent: opts.latent }),
    ...(opts.names === undefined ? {} : { names: opts.names }),
  };
}
