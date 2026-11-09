/** Apply action text models to the recursive source model; undo restores an immutable prior model state. */
import { compareBlocks, leaf, parseBlocks, refreshTouched } from './blocks.ts';
import type { BlockLevel, CorpusBlock } from './blocks.ts';
import { flattened, resolveText, touch } from './anchorModel.ts';
import type { LeafReference } from './anchorModel.ts';
import { actionErrors } from './metadataActions.ts';
import { applyTableAction } from './tableModel.ts';
import { htmlText, normalize } from './normalizations.ts';
import type { CorpusAction } from './types.ts';
function spliceText(block: CorpusBlock, start: number, end: number, text: string): void {
  const delta = text.length - (end - start);
  block.text = block.text.slice(0, start) + text + block.text.slice(end);
  block.protectedRanges = block.protectedRanges.map(([a, b]): [number, number] => {
    if (start === end && a <= start && b >= end) return [a, b + delta];
    const from = a < start ? a : a >= end ? a + delta : start;
    const to = b <= start ? b : b >= end ? b + delta : start + text.length;
    return [from, to];
  }).filter(([a, b]) => b > a);
}
function clearProtection(block: CorpusBlock, start: number, end: number): void {
  block.protectedRanges = block.protectedRanges.flatMap(([a, b]): [number, number][] =>
    b <= start || a >= end ? [[a, b]] : [...(a < start ? [[a, start] as [number, number]] : []), ...(b > end ? [[end, b] as [number, number]] : [])]);
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function generated(text: string): CorpusBlock { return { ...leaf(text), text, touched: true }; }
function replaceLeaf(ref: LeafReference, parts: CorpusBlock[], separators: string[]): void {
  ref.level.blocks.splice(ref.index, 1, ...parts);
  ref.level.separators.splice(ref.index + 1, 0, ...separators);
}
function insert(ref: LeafReference, offset: number, text: string, paste = false): void {
  touch(ref);
  const block = ref.block;
  if (ref.ancestors.some(parent => parent.cells) && text.includes('\n')) throw new Error('unmodeled table-cell break');
  if (!text.includes('\n') || block.kind === 'code' || block.kind === 'html') {
    spliceText(block, offset, offset, text); return;
  }
  const before = block.text.slice(0, offset), after = block.text.slice(offset);
  if (!after && /^\n+$/.test(text) && ref.index === ref.level.blocks.length - 1) return;
  const itemIndex = ref.ancestors.map(parent => parent.kind).lastIndexOf('item');
  if (itemIndex >= 0 && !paste) {
    if (/\n\n/.test(text)) throw new Error('unmodeled second empty-list-item break');
    const item = ref.ancestors[itemIndex], list = ref.ancestors[itemIndex - 1];
    if (!list?.children || !item.children || item.children.blocks.length !== 1) throw new Error('unmodeled list split shape');
    const pieces = (before + text + after).split('\n');
    const index = list.children.blocks.indexOf(item);
    const separator = list.children.separators.find(value => value === '\n' || value === '\n\n') ?? '\n';
    const items = pieces.map(piece => ({ ...generated(''), kind: 'item' as const, children: { blocks: [generated(piece)], separators: ['', ''] } }));
    list.children.blocks.splice(index, 1, ...items);
    list.children.separators.splice(index + 1, 0, ...pieces.slice(1).map(() => separator)); return;
  }
  if (paste) {
    const pasted = parseBlocks(normalize('N2', text));
    pasted.blocks.forEach(part => { part.touched = true; });
    const parts = [...(before ? [generated(before)] : []), ...pasted.blocks, ...(after ? [generated(after)] : [])];
    const seps = [...(before && pasted.blocks.length ? ['\n\n'] : []), ...pasted.separators.slice(1, -1), ...(after && pasted.blocks.length ? ['\n\n'] : [])];
    replaceLeaf(ref, parts, seps); return;
  }
  const pieces = (before + text + after).split('\n');
  if (pieces.at(-1) === '' && ref.index === ref.level.blocks.length - 1) pieces.pop();
  const parts: CorpusBlock[] = [], separators: string[] = []; let breaks = '';
  for (const piece of pieces) {
    if (piece) { if (parts.length) separators.push(breaks); parts.push(generated(piece)); breaks = '\n\n'; }
    else breaks += '\n\n';
  }
  replaceLeaf(ref, parts, separators);
}
function deleteRange(level: BlockLevel, action: Extract<CorpusAction, { kind: 'delete' }>): void {
  const anchor = resolveText(level, action.range); touch(anchor.from); touch(anchor.to);
  if (anchor.from.block === anchor.to.block) {
    spliceText(anchor.from.block, anchor.fromOffset, anchor.toOffset, ''); return;
  }
  if (anchor.from.level !== anchor.to.level) throw new Error('unmodeled cross-container join');
  const parent = anchor.from.level, first = anchor.from.index, last = anchor.to.index;
  if (parent.blocks.slice(first, last + 1).some(block => block.children || block.cells || block.kind === 'code' || block.kind === 'html')) throw new Error('unmodeled protected block join');
  const firstBlock = anchor.from.block, lastBlock = anchor.to.block;
  spliceText(firstBlock, anchor.fromOffset, firstBlock.text.length, lastBlock.text.slice(anchor.toOffset));
  firstBlock.protectedRanges.push(...lastBlock.protectedRanges.filter(([, b]) => b > anchor.toOffset).map(([a, b]): [number, number] =>
    [anchor.fromOffset + Math.max(a, anchor.toOffset) - anchor.toOffset, anchor.fromOffset + b - anchor.toOffset]));
  parent.blocks.splice(first + 1, last - first); parent.separators.splice(first + 1, last - first);
}
function matches(text: string, query: string, caseSensitive: boolean, wholeWord: boolean): [number, number][] {
  if (!query) throw new Error('empty find query');
  const source = caseSensitive ? text : text.toLowerCase(), needle = caseSensitive ? query : query.toLowerCase();
  const results: [number, number][] = []; let offset = 0;
  while (offset <= source.length) {
    const index = source.indexOf(needle, offset); if (index < 0) break;
    const end = index + needle.length;
    if (!wholeWord || ((!source[index - 1] || !/[\p{L}\p{N}_]/u.test(source[index - 1])) && (!source[end] || !/[\p{L}\p{N}_]/u.test(source[end])))) results.push([index, end]);
    offset = end;
  }
  return results;
}
function apply(level: BlockLevel, action: CorpusAction): void {
  const errors = actionErrors(action); if (errors.length) throw new Error(errors.join(', '));
  switch (action.kind) {
    case 'type': case 'paste': {
      if (action.kind === 'paste' && 'cells' in action.at) { applyTableAction(level, action); return; }
      if (!('text' in action.at)) throw new Error('anchor requires caret');
      const anchor = resolveText(level, action.at);
      if (anchor.from.block !== anchor.to.block) throw new Error('caret spans blocks');
      const text = action.kind === 'type' ? action.text : action.html === undefined ? action.text ?? '' : htmlText(action.html);
      insert(anchor.from, action.at.edge === 'before' ? anchor.fromOffset : anchor.toOffset, text, action.kind === 'paste' && /\n\s*\n/.test(text)); return;
    }
    case 'delete': deleteRange(level, action); return;
    case 'toggleMark': case 'clearFormat': case 'activateLink': {
      const anchor = resolveText(level, action.kind === 'activateLink' ? action.link : action.range);
      for (const ref of flattened(level).leaves) if (ref.start >= anchor.from.start && ref.end <= anchor.to.end) touch(ref);
      touch(anchor.from); touch(anchor.to);
      if (action.kind !== 'activateLink' && (action.kind === 'clearFormat' || action.mark === 'code')) {
        for (const ref of flattened(level).leaves.filter(ref => ref.start >= anchor.from.start && ref.end <= anchor.to.end)) {
          const start = ref.block === anchor.from.block ? anchor.fromOffset : 0;
          const end = ref.block === anchor.to.block ? anchor.toOffset : ref.block.text.length;
          const alreadyCode = ref.block.protectedRanges.some(([a, b]) => a <= start && b >= end);
          clearProtection(ref.block, start, end);
          if (action.kind === 'toggleMark' && !alreadyCode) ref.block.protectedRanges.push([start, end]);
        }
      }
      return;
    }
    case 'setListKind': {
      const anchor = resolveText(level, action.at);
      const list = [...anchor.from.ancestors].reverse().find(parent => parent.kind === 'list');
      if (!list?.children) throw new Error('anchor outside list');
      list.listKind = action.to; list.touched = true;
      list.children.blocks.forEach(item => { item.touched = true; if (item.children?.blocks[0]) item.children.blocks[0].touched = true; });
      return;
    }
    case 'insertTableRow': case 'insertTableColumn': applyTableAction(level, action); return;
    case 'find': case 'replace': {
      let replaced = false;
      for (const ref of flattened(level).leaves) {
        if (ref.block.kind === 'code' || ref.block.kind === 'html') continue;
        const hits = matches(ref.block.text, action.query, action.caseSensitive, action.wholeWord).filter(([start, end]) => !ref.block.protectedRanges.some(([a, b]) => start < b && end > a));
        if (action.kind === 'find') { if (hits.length) touch(ref); continue; }
        const selected = action.all ? hits : replaced ? [] : hits.slice(0, 1);
        for (const [start, end] of selected.reverse()) spliceText(ref.block, start, end, action.with);
        if (selected.length) { touch(ref); replaced = true; }
      }
      return;
    }
    case 'modeSwitch': return;
    case 'undo': return;
  }
}
export function assertSemanticActions(input: string, output: string, actions: CorpusAction | CorpusAction[]): void {
  let level = parseBlocks(input); const history: BlockLevel[] = [];
  for (const action of Array.isArray(actions) ? actions : [actions]) {
    if (action.kind === 'undo') { if (!history.length) throw new Error('undo without preceding edit'); level = history.pop()!; }
    else {
      if (!['find', 'modeSwitch', 'activateLink'].includes(action.kind)) history.push(copy(level));
      apply(level, action); refreshTouched(level);
    }
  }
  compareBlocks(level, parseBlocks(output));
}
