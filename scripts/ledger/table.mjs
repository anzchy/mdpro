/**
 * Purpose: The pipe-table primitives the ledger gate and the ledger renderer
 * share — how a line splits into cells, what a separator row is, and which
 * header marks the inventory table.
 *
 * Key decisions:
 * - ONE definition for both consumers. `parse.mjs` and `md.mjs` used to carry
 *   their own copies, and they disagreed: the parser accepted an inventory
 *   table with no separator row while the renderer turned it into a paragraph,
 *   so `ledger:check` passed rows the HTML never showed (D71 / audit #45).
 *
 * @module scripts/ledger/table
 * @coordinates-with scripts/ledger/parse.mjs, scripts/ledger/md.mjs
 */

/** The exact header that marks the inventory table; no other table is rows. */
export const INVENTORY_HEADER = Object.freeze(["能力", "状态", "在哪", "怎么确认"]);

/**
 * Split one markdown table line into trimmed cells, honouring `\|` escapes.
 * Returns null when the line is not a table row.
 */
export function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells = [];
  let current = "";
  for (let i = 1; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") cells.push(current.trim());
  return cells;
}

export const isSeparatorRow = (cells) =>
  cells !== null && cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));

export const isInventoryHeader = (cells) =>
  cells !== null &&
  cells.length === INVENTORY_HEADER.length &&
  cells.every((cell, i) => cell === INVENTORY_HEADER[i]);
