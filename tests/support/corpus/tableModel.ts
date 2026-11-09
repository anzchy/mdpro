/** Table reference actions operate on ordered cell matrices rather than flattened document text. */
import { leaf, parseBlocks } from './blocks.ts';
import type { BlockLevel, CorpusBlock } from './blocks.ts';
import type { CorpusAction } from './types.ts';
import { htmlText } from './normalizations.ts';
export function tables(level: BlockLevel): CorpusBlock[] {
  return level.blocks.flatMap(block => block.cells ? [block] : block.children ? tables(block.children) : []);
}
export function applyTableAction(level: BlockLevel, action: Extract<CorpusAction, { kind: 'insertTableRow' | 'insertTableColumn' | 'paste' }>): void {
  const at = action.at;
  const range = 'cells' in at;
  const coordinate = range ? at.cells : 'cell' in at ? at.cell : undefined;
  if (!coordinate) throw new Error('anchor requires cell');
  const table = tables(level)[coordinate.table - 1];
  if (!table?.cells) throw new Error('anchor table beyond count');
  const rows = table.cells;
  const from: [number, number] = range ? at.cells.from : ['row' in coordinate ? coordinate.row : 0, 'col' in coordinate ? coordinate.col : 0];
  const to: [number, number] = range ? at.cells.to : from;
  if (from[0] > to[0] || from[1] > to[1] || [from, to].some(([r, c]) => !Number.isInteger(r) || !Number.isInteger(c) || r < 1 || c < 1 || r > rows.length || c > rows[r - 1].length)) throw new Error('anchor cell range invalid or beyond bounds');
  table.touched = true;
  if (action.kind === 'insertTableRow') rows.splice(from[0] - 1 + (action.side === 'below' ? 1 : 0), 0, rows[0].map(() => ({ ...leaf(''), touched: true })));
  else if (action.kind === 'insertTableColumn') rows.forEach(row => row.splice(from[1] - 1 + (action.side === 'right' ? 1 : 0), 0, { ...leaf(''), touched: true }));
  else {
    const content = action.html === undefined ? action.text ?? '' : htmlText(action.html);
    const parsed = parseBlocks(content);
    const matrix = parsed.blocks[0]?.cells;
    const htmlRows = action.html?.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi);
    const htmlCells = htmlRows?.flatMap(row => Array.from(row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi), cell => htmlText(cell[1])));
    const values = htmlCells ?? (matrix ? matrix.flatMap(row => row.map(cell => cell.text)) : content.split(/\t|\r?\n/));
    const cellCount = (to[0] - from[0] + 1) * (to[1] - from[1] + 1);
    const repeatPlainValue = action.html === undefined && values.length === 1;
    if (!repeatPlainValue && values.length !== cellCount) throw new Error('anchor paste cell count mismatch');
    let index = 0;
    for (let row = from[0] - 1; row < to[0]; row++) for (let col = from[1] - 1; col < to[1]; col++) {
      rows[row][col].text = values[repeatPlainValue ? 0 : index++]; rows[row][col].touched = true;
    }
  }
}
