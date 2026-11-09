Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
const { afterEach, beforeEach, expect, it } = await import('vitest');
const { FakeTauriBoundary } = await import('./support/corpus/fakeBoundary.ts');
const { installCorpusBoundary } = await import('./support/corpus/boundaryMocks.ts');
import type { CorpusAction, CorpusDriver, Mark } from './support/corpus/types.ts';

let driver: CorpusDriver;
beforeEach(async () => {
  const boundary = new FakeTauriBoundary();
  installCorpusBoundary(boundary);
  const { createMilkdownDriver } = await import('./support/corpus/milkdownDriver.tsx');
  driver = createMilkdownDriver(boundary, { caseId: 'actions-case' });
});
afterEach(async () => { await driver?.cleanup(); });
const at = (text: string, edge: 'before' | 'after' = 'after') => ({ text, edge });
async function edit(input: string, action: CorpusAction): Promise<string> {
  await driver.mount(input, 'any'); await driver.runAction(action); return driver.serialize();
}
const table = '| A | B |\n| - | - |\n| C | D |\n';
const cell = (row: number, col: number, table = 1) => ({ cell: { table, row, col } });
const range = { cells: { table: 1, from: [1, 1] as [number, number], to: [2, 2] as [number, number] } };
function rows(tableIndex = 0): string[][] {
  return [...document.querySelectorAll('.ProseMirror table')][tableIndex]
    ? [...document.querySelectorAll('.ProseMirror table')[tableIndex].querySelectorAll('tr')]
      .map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent ?? '')) : [];
}

it.each([
  ['before', 'keep Xbeta tail\n'], ['after', 'keep betaX tail\n'],
] as const)('types at the %s edge', async (edge, output) => {
  expect(await edit('keep beta tail\n', { kind: 'type', at: at('beta', edge), text: 'X' })).toBe(output);
});
it('supports multiline typing without losing adjacent text', async () => {
  expect(await edit('keep beta tail\n', { kind: 'type', at: at('beta'), text: 'X\nY' })).toBe('keep betaX\n\nY tail\n');
});
it.each([[undefined, 'beta! beta\n'], [2, 'beta beta!\n']] as const)('addresses duplicate occurrence %s', async (occurrence, output) => {
  expect(await edit('beta beta\n', { kind: 'type', at: { ...at('beta'), occurrence }, text: '!' })).toBe(output);
});
it('matches rendered text across mark boundaries', async () => {
  expect(await edit('keep be**ta** tail\n', { kind: 'delete', range: { text: 'beta' } })).toBe('keep  tail\n');
});
it('deletes only the selected same-block text', async () => {
  expect(await edit('keep beta tail\n', { kind: 'delete', range: { text: 'beta' } })).toBe('keep  tail\n');
});
it('deletes across an encoded empty paragraph and joins only the selected blocks', async () => {
  expect(await edit('left a\n\n\n\nb right\n', { kind: 'delete', range: { text: 'a\n\nb' } })).toBe('left  right\n');
});
it('accepts a complete ZWJ grapheme and keeps decomposed Unicode exact', async () => {
  expect(await edit('👩‍💻 é\n', { kind: 'type', at: at('👩‍💻'), text: '!' })).toBe('👩‍💻! é\n');
});
it('rejects missing, split-grapheme, normalized, boundary and invalid occurrence anchors atomically', async () => {
  await driver.mount('beta beta 👩‍💻 é\n\nnext\n', 'any');
  await driver.runAction({ kind: 'toggleMark', range: { text: 'next' }, mark: 'strong' });
  const before = await driver.serialize(), selection = await driver.observe('selection');
  const anchors = [at('missing'), at('👩'), at('é'), at('\n'), at('beta', 'after')];
  const actions: CorpusAction[] = anchors.slice(0, 4).map(anchor => ({ kind: 'type', at: anchor, text: '!' }));
  for (const occurrence of [0, -1, 0.5, NaN, Infinity, -Infinity, 3]) actions.push({ kind: 'type', at: { ...anchors[4], occurrence }, text: '!' });
  for (const action of actions) {
    await expect(driver.runAction(action)).rejects.toThrow(/actions-case.*anchor/i);
    expect(await driver.serialize()).toBe(before); expect(await driver.observe('selection')).toEqual(selection);
  }
});
it.each([
  ['strong', '**beta**'], ['emphasis', '*beta*'], ['code', '`beta`'],
  ['strike', '~~beta~~'], ['highlight', '==beta=='], ['underline', '<u>beta</u>'],
] as [Mark, string][])('toggles %s on and off, preserving selection and surrounding text', async (mark, marked) => {
  await driver.mount('keep beta tail\n', 'any');
  const action: CorpusAction = { kind: 'toggleMark', range: { text: 'beta' }, mark };
  await driver.runAction(action);
  expect(await driver.serialize()).toBe(`keep ${marked} tail\n`);
  expect(await driver.observe('selection')).toEqual({ text: 'beta' });
  await driver.runAction(action); expect(await driver.serialize()).toBe('keep beta tail\n');
});
it('clears nested formatting while retaining the link target', async () => {
  expect(await edit('keep [**<u>beta</u>**](https://example.com) tail\n', { kind: 'clearFormat', range: { text: 'beta' } }))
    .toBe('keep [beta](https://example.com) tail\n');
});
it.each(['type', 'toggleMark'] as const)('%s then undo restores bytes and anchored selection', async kind => {
  await driver.mount('keep beta tail\n', 'any');
  await driver.runAction(kind === 'type' ? { kind, at: at('beta'), text: '!' } : { kind, range: { text: 'beta' }, mark: 'strong' });
  await driver.runAction({ kind: 'undo' });
  expect(await driver.serialize()).toBe('keep beta tail\n');
  expect(await driver.observe('selection')).toEqual({ text: kind === 'type' ? '' : 'beta' });
});
it.each([
  ['- A\n  - B\n- C\n', 'ordered', '1. A\n   - B\n2. C\n'],
  ['- A\n\n  - B\n\n- C\n', 'ordered', '1. A\n\n   - B\n\n2. C\n'],
  ['1. A\n   - B\n2. C\n', 'bullet', '- A\n  - B\n- C\n'],
] as const)('converts list kind preserving nested content and spacing %s', async (input, to, output) => {
  expect(await edit(input, { kind: 'setListKind', at: at('A'), to })).toBe(output);
  await driver.runAction({ kind: 'undo' }); expect(await driver.serialize()).toBe(input);
});
it.each(['*', '+', ')'])('HTML-created nested list markers do not inherit parent %s', async marker => {
  const input = marker === ')' ? '1) Parent\n' : `${marker} Parent\n`;
  await driver.mount(input, 'any');
  await driver.runAction({ kind: 'paste', at: at('Parent'), html: '<ul><li>A<ul><li>B</li></ul></li></ul>' });
  const output = await driver.serialize();
  expect(output).toBe(marker === ')' ? '1) ParentA\n   - B\n' : `${marker} ParentA\n  - B\n`);
});
it.each([
  ['insertTableRow', 'above', 1, 1, [['', ''], ['A', 'B'], ['C', 'D']]],
  ['insertTableRow', 'below', 2, 2, [['A', 'B'], ['C', 'D'], ['', '']]],
  ['insertTableColumn', 'left', 1, 1, [['', 'A', 'B'], ['', 'C', 'D']]],
  ['insertTableColumn', 'right', 2, 2, [['A', 'B', ''], ['C', 'D', '']]],
] as const)('inserts %s %s at the named edge', async (kind, side, row, col, expected) => {
  await edit(table, { kind, side, at: cell(row, col) } as CorpusAction);
  expect(rows()).toEqual(expected);
});
it('addresses the second table without editing the first', async () => {
  await edit(table + '\nBetween\n\n' + table, { kind: 'insertTableColumn', side: 'right', at: cell(2, 1, 2) });
  expect(rows()).toEqual([['A', 'B'], ['C', 'D']]); expect(rows(1)).toEqual([['A', '', 'B'], ['C', '', 'D']]);
});
it('rejects invalid numeric cell coordinates and ranges without changing selection or bytes', async () => {
  await driver.mount(table, 'any');
  const before = await driver.serialize(), selection = await driver.observe('selection');
  const actions: CorpusAction[] = [];
  for (const value of [0, -1, 0.5, NaN, Infinity, -Infinity, 3]) for (const key of ['table', 'row', 'col']) {
    actions.push({ kind: 'insertTableRow', at: { cell: { table: 1, row: 1, col: 1, [key]: value } }, side: 'below' });
  }
  for (const [from, to] of [[[2, 2], [1, 1]], [[0, 1], [2, 2]], [[1, 1], [3, 2]], [[1, 1], [2, 3]]]) {
    actions.push({ kind: 'paste', at: { cells: { table: 1, from: from as [number, number], to: to as [number, number] } }, text: 'X' });
  }
  for (const action of actions) {
    await expect(driver.runAction(action)).rejects.toThrow(/actions-case.*anchor/i);
    expect(await driver.serialize()).toBe(before); expect(await driver.observe('selection')).toEqual(selection);
  }
});
it('pastes plain text through the clipboard path', async () => {
  expect(await edit('keep beta tail\n', { kind: 'paste', at: at('beta'), text: 'X' })).toBe('keep betaX tail\n');
});
it('pastes interior empty HTML paragraphs through the production parser', async () => {
  expect(await edit('anchor\n\nTail\n', { kind: 'paste', at: at('anchor'), html: '<p>A</p><p></p><p>B</p>' }))
    .toBe('anchorA\n\n\n\nB\n\nTail\n');
});
it('pastes HTML cells into a named range in reading order', async () => {
  await edit(table, { kind: 'paste', at: range, html: '<table><tr><td>X</td><td>Y</td></tr><tr><td>Z</td><td>W</td></tr></table>' });
  expect(rows()).toEqual([['X', 'Y'], ['Z', 'W']]);
});
it('pastes plain content over a multi-cell range using production repetition', async () => {
  await edit(table, { kind: 'paste', at: range, text: 'X' }); expect(rows()).toEqual([['X', 'X'], ['X', 'X']]);
});
it('sanitizes dangerous HTML in the live paste pipeline', async () => {
  await edit('anchor\n', { kind: 'paste', at: at('anchor'), html: '<script>bad()</script><img src=x onerror=bad()><a href="javascript:bad()">safe</a>' });
  expect(await driver.observe('pasteSafety')).toEqual({ forbiddenFound: [] });
  expect(await driver.serialize()).toContain('safe'); expect(await driver.serialize()).not.toContain('bad()');
});
it('refuses a mixed table paste over cells without changing bytes or selection', async () => {
  await driver.mount(table, 'any'); const before = await driver.serialize();
  await driver.runAction({ kind: 'paste', at: range, html: '<p>before</p><table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table><p>after</p>' });
  expect(await driver.serialize()).toBe(before); expect(await driver.observe('selection')).toEqual({ text: 'A\nB\nC\nD' });
});
it.each([[false, false, 6], [false, true, 5], [true, false, 5], [true, true, 4]] as const)('find obeys case=%s word=%s', async (caseSensitive, wholeWord, count) => {
  const input = 'beta Beta betamax beta\n\nbeta\n\nbe**ta**\n\n`beta`\n\n```\nbeta\n```\n';
  await driver.mount(input, 'any');
  await driver.runAction({ kind: 'find', query: 'beta', caseSensitive, wholeWord });
  const found = await driver.observe('find');
  expect(found.query).toBe('beta'); expect(found.options).toEqual({ caseSensitive, wholeWord }); expect(found.matches).toHaveLength(count);
  expect(found.matches.slice(-1)).toEqual([{ text: 'beta', occurrence: count, block: 3 }]);
  expect(await driver.serialize()).toBe(input);
});
it.each([[false, 'X Beta betamax beta\n\nbeta\n'], [true, 'X Beta betamax X\n\nX\n']] as const)('replaces all=%s and undo restores bytes', async (all, output) => {
  const input = 'beta Beta betamax beta\n\nbeta\n';
  expect(await edit(input, { kind: 'replace', query: 'beta', with: 'X', all, caseSensitive: true, wholeWord: true })).toBe(output);
  await driver.runAction({ kind: 'undo' }); expect(await driver.serialize()).toBe(input);
});
it('switches modes while preserving the exact input bytes', async () => {
  const input = 'a  \nb\n'; await driver.mount(input, 'any');
  await driver.runAction({ kind: 'modeSwitch', to: 'source' }); await driver.runAction({ kind: 'modeSwitch', to: 'wysiwyg' });
  expect(await driver.untouched()).toBe(input); expect(await driver.serialize()).toBe('a\\\nb\n');
});
it.each(['*', '+', ')'])('new nested bullet containers use defaults inside parent %s', async marker => {
  await driver.mount(marker === ')' ? '1) Parent\n' : `${marker} Parent\n`, 'any');
  await driver.runAction({ kind: 'paste', at: at('Parent'), html: '<ul><li>lead<ul><li>A<ul><li>B</li></ul></li></ul></li></ul>' });
  expect(await driver.serialize()).toBe(marker === ')' ? '1) Parentlead\n   - A\n     - B\n' : `${marker} Parentlead\n  - A\n    - B\n`);
});
it.each(['*', '+', ')'])('new nested ordered containers use defaults inside parent %s', async marker => {
  await driver.mount(marker === ')' ? '1) Parent\n' : `${marker} Parent\n`, 'any');
  await driver.runAction({ kind: 'paste', at: at('Parent'), html: '<ol><li>lead<ol><li>A<ol><li>B</li></ol></li></ol></li></ol>' });
  expect(await driver.serialize()).toBe(marker === ')' ? '1) Parentlead\n   1. A\n      1. B\n' : `${marker} Parentlead\n  1. A\n     1. B\n`);
});
