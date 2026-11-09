/** Recursive plain-text block/separator model. Separators retain exact source bytes after container prefix removal. */
import { inlineProjection } from './blocksVisible.ts';
export interface BlockLevel { blocks: CorpusBlock[]; separators: string[] }
export interface CorpusBlock {
  kind: 'paragraph' | 'code' | 'html' | 'quote' | 'list' | 'item' | 'table';
  raw: string; text: string; touched: boolean; protectedRanges: [number, number][];
  children?: BlockLevel; cells?: CorpusBlock[][]; listKind?: 'bullet' | 'ordered';
}
export function leaf(raw: string, kind: 'paragraph' | 'code' | 'html' = 'paragraph'): CorpusBlock {
  let text = raw, protectedRanges: [number, number][] = [];
  if (kind === 'paragraph') ({ text, protectedRanges } = inlineProjection(raw));
  else if (kind === 'code') {
    const fence = raw.match(/^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n {0,3}(?:`{3,}|~{3,})[ \t]*$/);
    text = fence ? fence[2] : raw.replace(/^(?: {4}|\t)/gm, '');
  }
  return { kind, raw, text, touched: false, protectedRanges };
}
export function pipeCells(line: string): string[] {
  const cells: string[] = []; let cell = '', ticks = '';
  const value = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (character === '\\' && i + 1 < value.length) { cell += character + value[++i]; continue; }
    if (character === '`') {
      let end = i; while (value[end] === '`') end++;
      const marker = value.slice(i, end); ticks = ticks === marker ? '' : ticks || marker; cell += marker; i = end - 1;
    } else if (character === '|' && !ticks) { cells.push(cell.trim()); cell = ''; }
    else cell += character;
  }
  cells.push(cell.trim()); return cells;
}
const listMarker = (line: string) => line.match(/^( {0,3})([-+*]|\d+[.)])([ \t]+)(.*)$/);
const isQuote = (line: string) => /^ {0,3}>/.test(line);
const fenceMarker = (line: string) => line.match(/^ {0,3}(`{3,}|~{3,})/);
const isHtml = (line: string) => /^ {0,3}(?:<!--|<!\[CDATA\[|<\?|<![A-Z]|<(?:div|p|table|script|style|section|article|pre|textarea|title|xmp|iframe|noembed|noframes|plaintext)\b)/i.test(line);
const isIndented = (line: string) => /^(?: {4}|\t)/.test(line);
const isHeading = (line: string) => /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line);
const blank = (line: string) => /^[ \t]*$/.test(line);
function tableStart(lines: string[], index: number): boolean {
  return index + 1 < lines.length && lines[index].includes('|') && pipeCells(lines[index + 1]).every(cell => /^:?-+:?$/.test(cell)) && pipeCells(lines[index + 1]).length >= 1;
}
function listBlock(raw: string): CorpusBlock {
  const lines = raw.split('\n'), first = listMarker(lines[0])!;
  const indent = first[1].length, kind = /^\d/.test(first[2]) ? 'ordered' : 'bullet';
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = listMarker(lines[i]);
    if (marker && marker[1].length === indent) starts.push(i);
  }
  const offsets: number[] = []; let position = 0;
  for (const line of lines) { offsets.push(position); position += line.length + 1; }
  const children: BlockLevel = { blocks: [], separators: [''] };
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i], next = starts[i + 1] ?? lines.length;
    let end = next; while (end > start + 1 && blank(lines[end - 1])) end--;
    const marker = listMarker(lines[start])!, width = marker[1].length + marker[2].length + marker[3].length;
    const source = lines.slice(start, end).join('\n');
    const inner = [marker[4], ...lines.slice(start + 1, end).map(line => line.slice(0, width).trim() === '' ? line.slice(width) : line)].join('\n');
    children.blocks.push({ ...leaf(source), kind: 'item', children: parseBlocks(inner) });
    const endOffset = offsets[end - 1] + lines[end - 1].length;
    children.separators.push(raw.slice(endOffset, starts[i + 1] === undefined ? raw.length : offsets[next]));
  }
  return { ...leaf(raw), kind: 'list', children, listKind: kind };
}
export function parseBlocks(source: string): BlockLevel {
  const lines = source.split('\n'), offsets: number[] = []; let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const level: BlockLevel = { blocks: [], separators: [] };
  let index = 0, previousEnd = 0;
  while (index < lines.length) {
    if (blank(lines[index])) { index++; continue; }
    const start = index; let kind: CorpusBlock['kind'] = 'paragraph';
    const fence = fenceMarker(lines[index]);
    if (fence) {
      kind = 'code'; index++;
      const close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \\t]*$');
      while (index < lines.length && !close.test(lines[index])) index++;
      if (index < lines.length) index++;
    } else if (isQuote(lines[index])) {
      kind = 'quote'; index++;
      while (index < lines.length && (isQuote(lines[index]) || (!blank(lines[index]) && !listMarker(lines[index]) && !fenceMarker(lines[index]) && !isHeading(lines[index])))) index++;
    } else if (listMarker(lines[index])) {
      kind = 'list'; const initial = listMarker(lines[index])!, indent = initial[1].length; index++;
      while (index < lines.length) {
        let look = index; while (look < lines.length && blank(lines[look])) look++;
        if (look === lines.length) break;
        const sibling = listMarker(lines[look]);
        const continues = (sibling && sibling[1].length === indent && /^\d/.test(sibling[2]) === /^\d/.test(initial[2])) || /^\s/.test(lines[look]);
        if (look > index && !continues) break;
        if (!continues && (isQuote(lines[index]) || isHeading(lines[index]) || fenceMarker(lines[index]) || sibling)) break;
        index = look + 1;
      }
    } else if (tableStart(lines, index)) {
      kind = 'table'; index += 2; while (index < lines.length && !blank(lines[index]) && lines[index].includes('|')) index++;
    } else if (isIndented(lines[index])) {
      kind = 'code'; index++;
      while (index < lines.length) {
        if (isIndented(lines[index])) { index++; continue; }
        let look = index; while (look < lines.length && blank(lines[look])) look++;
        if (look < lines.length && isIndented(lines[look])) index = look + 1;
        else break;
      }
    } else if (isHtml(lines[index])) {
      kind = 'html';
      const first = lines[index], tag = first.match(/^ {0,3}<([a-z]+)/i)?.[1];
      const terminator = first.includes('<!--') ? '-->' : first.includes('<![CDATA[') ? ']]>' : first.includes('<?') ? '?>' : tag ? '</' + tag + '>' : '>';
      let close = index;
      while (close < lines.length && !lines[close].toLowerCase().includes(terminator.toLowerCase())) close++;
      if (close < lines.length) index = close + 1;
      else { index++; while (index < lines.length && !blank(lines[index])) index++; }
    } else if (isHeading(lines[index])) index++;
    else {
      index++;
      while (index < lines.length && !blank(lines[index]) && !isHeading(lines[index]) && !isQuote(lines[index]) && !listMarker(lines[index]) && !fenceMarker(lines[index]) && !isHtml(lines[index])) index++;
    }
    const end = offsets[index - 1] + lines[index - 1].length;
    const raw = source.slice(offsets[start], end);
    level.separators.push(source.slice(previousEnd, offsets[start]));
    let block: CorpusBlock;
    if (kind === 'list') block = listBlock(raw);
    else if (kind === 'quote') block = { ...leaf(raw), kind, children: parseBlocks(raw.split('\n').map(line => line.replace(/^ {0,3}> ?/, '')).join('\n')) };
    else if (kind === 'table') {
      const rows = raw.split('\n').filter((_, row) => row !== 1).map(row => pipeCells(row).map(cell => leaf(cell)));
      block = { ...leaf(raw), kind, cells: rows };
    } else block = leaf(raw, kind === 'code' || kind === 'html' ? kind : 'paragraph');
    level.blocks.push(block); previousEnd = end;
  }
  level.separators.push(source.slice(previousEnd));
  return level;
}
export function refreshTouched(level: BlockLevel): boolean {
  return level.blocks.reduce((changed, block) => {
    if (block.children) block.touched = refreshTouched(block.children) || block.touched;
    if (block.cells) block.touched = block.cells.some(row => row.some(cell => cell.touched)) || block.touched;
    return block.touched || changed;
  }, false);
}
export function compareBlocks(model: BlockLevel, actual: BlockLevel): void {
  if (JSON.stringify(model.separators) !== JSON.stringify(actual.separators)) throw new Error('semantic separator drift');
  if (model.blocks.length !== actual.blocks.length) throw new Error('semantic block count drift');
  model.blocks.forEach((expected, index) => {
    const observed = actual.blocks[index];
    if (!expected.touched) { if (expected.raw !== observed.raw) throw new Error('unedited block bytes changed'); return; }
    if (expected.children) {
      if (expected.kind !== observed.kind || !observed.children) throw new Error('semantic container kind changed');
      if (expected.kind === 'list' && expected.listKind !== observed.listKind) throw new Error('list kind differs from action');
      compareBlocks(expected.children, observed.children);
    } else if (expected.cells) {
      if (!observed.cells || expected.cells.length !== observed.cells.length || expected.cells.some((row, r) => row.length !== observed.cells![r].length)) throw new Error('table dimensions changed');
      expected.cells.forEach((row, r) => row.forEach((cell, c) => {
        const other = observed.cells![r][c];
        if ((cell.touched ? cell.text : cell.raw) !== (cell.touched ? other.text : other.raw)) throw new Error('table cell drift');
      }));
    } else {
      if ((expected.kind === 'code' || expected.kind === 'html') && expected.kind !== observed.kind) throw new Error('protected block kind changed');
      const expectedText = expected.kind === 'paragraph' && expected.protectedRanges.length === 0 ? expected.text.replace(/\s+/g, ' ').trim() : expected.text;
      if (expectedText !== observed.text) throw new Error('action text drift');
    }
  });
}
