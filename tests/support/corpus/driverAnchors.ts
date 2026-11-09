/** Resolve exact rendered-text and 1-based table anchors before any selection mutation. */
import type { Node as PmNode } from '@milkdown/kit/prose/model';
import { TableMap } from '@milkdown/kit/prose/tables';
import type { MilkdownDriverRuntime } from './milkdownDriverTypes.ts';
import type { Cell, CellRange, TextSelection } from './types.ts';

interface TextBlock { text: string; starts: number[]; ends: number[]; protected: [number, number][] }
export interface RenderedDocument extends TextBlock { blocks: { start: number; end: number; pos: number }[] }
/** Keep rendered characters contiguous across marks, with one LF for each textblock boundary. */
export function renderedDocument(doc: PmNode): RenderedDocument {
  const result: RenderedDocument = { text: '', starts: [], ends: [], protected: [], blocks: [] };
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (result.blocks.length) { result.text += '\n'; result.starts.push(-1); result.ends.push(-1); }
    const start = result.text.length;
    node.descendants((child, offset) => {
      let text = child.isText ? child.text ?? '' : child.type.name === 'hardbreak' ? '\n' : '';
      const literal = child.type.name === 'html';
      if (literal) text = String(child.attrs.value ?? '');
      const base = result.text.length;
      result.text += text;
      for (let i = 0; i < text.length; i++) {
        result.starts.push(pos + 1 + offset + (child.isText ? i : 0));
        result.ends.push(pos + 1 + offset + (child.isText ? i + 1 : child.nodeSize));
      }
      if (literal) result.protected.push([base, result.text.length]);
    });
    result.blocks.push({ start, end: result.text.length, pos });
    return false;
  });
  return result;
}
function fail(runtime: MilkdownDriverRuntime, reason: string): never {
  throw new Error(`${runtime.caseId}: anchor ${reason}`);
}
function positive(value: number): boolean { return Number.isInteger(value) && value > 0; }
function boundary(text: string, index: number): boolean {
  return index === text.length || Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
    .some(segment => segment.index === index);
}
export function resolveTextAnchor(runtime: MilkdownDriverRuntime, anchor: TextSelection, caret = false): { from: number; to: number } {
  const occurrence = anchor.occurrence ?? 1;
  if (!anchor.text || !positive(occurrence) || (caret && anchor.text.includes('\n'))) fail(runtime, 'invalid text/occurrence');
  const rendered = renderedDocument(runtime.view().state.doc);
  let start = -1, offset = 0;
  for (let n = 0; n < occurrence; n++) {
    start = rendered.text.indexOf(anchor.text, offset);
    if (start < 0) fail(runtime, 'missing or occurrence beyond count');
    offset = start + anchor.text.length;
  }
  const end = start + anchor.text.length;
  if (!boundary(rendered.text, start) || !boundary(rendered.text, end)) fail(runtime, 'splits grapheme');
  if (rendered.protected.some(([a, b]) => start < b && end > a)) fail(runtime, 'inside HTML source');
  const from = rendered.starts[start], to = rendered.ends[end - 1];
  if (from === undefined || to === undefined || from < 0 || to < 0) fail(runtime, 'on block boundary');
  return { from, to };
}
/** Absolute position just before the named cell; table/row/column are all 1-based. */
export function resolveCellAnchor(runtime: MilkdownDriverRuntime, anchor: Cell): number {
  const { table, row, col } = anchor.cell;
  if (![table, row, col].every(positive)) fail(runtime, 'invalid cell coordinates');
  const tables: { node: PmNode; pos: number }[] = [];
  runtime.view().state.doc.descendants((node, pos) => { if (node.type.name === 'table') tables.push({ node, pos }); });
  const target = tables[table - 1];
  if (!target) fail(runtime, 'table beyond count');
  const map = TableMap.get(target.node);
  if (row > map.height || col > map.width) fail(runtime, 'cell beyond bounds');
  return target.pos + 1 + map.positionAt(row - 1, col - 1, target.node);
}
export function resolveCellRange(runtime: MilkdownDriverRuntime, anchor: CellRange): { from: number; to: number } {
  const { table, from, to } = anchor.cells;
  if (!Array.isArray(from) || !Array.isArray(to) || from.length !== 2 || to.length !== 2 ||
      ![table, ...from, ...to].every(positive) || from[0] > to[0] || from[1] > to[1]) fail(runtime, 'invalid or reversed cell range');
  return {
    from: resolveCellAnchor(runtime, { cell: { table, row: from[0], col: from[1] } }),
    to: resolveCellAnchor(runtime, { cell: { table, row: to[0], col: to[1] } }),
  };
}
