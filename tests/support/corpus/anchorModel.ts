/** Resolve exact rendered-text anchors over the recursive reference model, including encoded empty paragraphs. */
import type { BlockLevel, CorpusBlock } from './blocks.ts';
import type { TextSelection } from './types.ts';
export interface LeafReference { block: CorpusBlock; level: BlockLevel; index: number; ancestors: CorpusBlock[]; start: number; end: number }
export function flattened(level: BlockLevel): { text: string; leaves: LeafReference[] } {
  let text = ''; const leaves: LeafReference[] = [];
  function add(block: CorpusBlock, parent: BlockLevel, index: number, ancestors: CorpusBlock[]) {
    if (leaves.length) text += '\n';
    const start = text.length; text += block.text;
    leaves.push({ block, level: parent, index, ancestors, start, end: text.length });
  }
  function walk(parent: BlockLevel, ancestors: CorpusBlock[]) {
    parent.blocks.forEach((block, index) => {
      if (index > 0 && ancestors.at(-1)?.kind !== 'list') {
        const breaks = (parent.separators[index].match(/\n/g) ?? []).length;
        text += '\n'.repeat(Math.max(0, Math.floor((breaks - 2) / 2)));
      }
      if (block.children) walk(block.children, [...ancestors, block]);
      else if (block.cells) block.cells.forEach(row => row.forEach(cell => add(cell, parent, index, [...ancestors, block])));
      else add(block, parent, index, ancestors);
    });
  }
  walk(level, []); return { text, leaves };
}
function graphemeBoundary(text: string, index: number): boolean {
  if (index === text.length) return true;
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).some(segment => segment.index === index);
}
export function resolveText(level: BlockLevel, selection: TextSelection): { from: LeafReference; to: LeafReference; fromOffset: number; toOffset: number; text: string } {
  const view = flattened(level), occurrence = selection.occurrence ?? 1;
  if (!selection.text || !Number.isInteger(occurrence) || occurrence < 1) throw new Error('anchor invalid text/occurrence');
  let start = -1, offset = 0;
  for (let n = 0; n < occurrence; n++) { start = view.text.indexOf(selection.text, offset); if (start < 0) throw new Error('anchor missing or occurrence beyond count'); offset = start + selection.text.length; }
  const end = start + selection.text.length;
  if (!graphemeBoundary(view.text, start) || !graphemeBoundary(view.text, end)) throw new Error('anchor splits grapheme');
  const from = view.leaves.find(leaf => start >= leaf.start && start < leaf.end);
  const to = view.leaves.find(leaf => end > leaf.start && end <= leaf.end);
  if (!from || !to) throw new Error('anchor on block boundary');
  return { from, to, fromOffset: start - from.start, toOffset: end - to.start, text: view.text.slice(start, end) };
}
export function touch(reference: LeafReference): void {
  reference.block.touched = true;
  reference.ancestors.forEach(block => { block.touched = true; });
}
