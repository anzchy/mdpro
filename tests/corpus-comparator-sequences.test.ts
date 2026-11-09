import { expect, it } from 'vitest';
import { compareCase } from './support/corpus/comparator.ts';
import type { CorpusAction, MountingRecord } from './support/corpus/types.ts';
function evaluate(input: string, serialized: string, action: CorpusAction | CorpusAction[]) {
  const record: MountingRecord = { caseId: 'a-sequence-model', category: 'a', status: 'active', actionGroup: 'edited', fidelityTag: 'semantic-roundtrip',
    input: 'edited/a/input.md', expected: { serialized: 'edited/a/expected.md' }, action, normalizations: [], platform: 'any', baselineSha: 'a'.repeat(40),
    rationale: 'Preserve protected offsets and cell reading order.', guardedPaths: [], consumers: [], negative: { kind: 'alterByte' } };
  return () => compareCase(record, { input, expectedSerialized: serialized }, { untouched: input, serialized });
}
const replaceCode: CorpusAction = { kind: 'replace', query: 'code', with: 'LOST', all: true, caseSensitive: false, wholeWord: false };
it.each([
  ['type', { kind: 'type', at: { text: 'target', edge: 'before' }, text: 'LONGPREFIX' }, 'LONGPREFIXtarget `code` beta\n'],
  ['delete', { kind: 'delete', range: { text: 'target ' } }, '`code` beta\n'],
  ['replace', { kind: 'replace', query: 'target', with: 'X', all: true, caseSensitive: false, wholeWord: false }, 'X `code` beta\n'],
] as [string, CorpusAction, string][])('updates protected code offsets after %s before a later replace', (_kind, first, output) => {
  const input = 'target `code` beta\n';
  expect(evaluate(input, output, [first, replaceCode])).not.toThrow();
  expect(evaluate(input, output.replace('`code`', '`LOST`'), [first, replaceCode])).toThrow('a-sequence-model');
});
it('retains protection after editing inside a code span and undoing a prefix insertion', () => {
  const input = 'target `code` beta\n';
  const within: CorpusAction = { kind: 'type', at: { text: 'code', edge: 'after' }, text: 'X' };
  const replaceExtended: CorpusAction = { ...replaceCode, query: 'codeX' };
  expect(evaluate(input, 'target `codeX` beta\n', [within, replaceExtended])).not.toThrow();
  expect(evaluate(input, 'target `LOST` beta\n', [within, replaceExtended])).toThrow('a-sequence-model');
  const prefix: CorpusAction = { kind: 'type', at: { text: 'target', edge: 'before' }, text: 'LONG' };
  expect(evaluate(input, input, [prefix, { kind: 'undo' }, replaceCode])).not.toThrow();
});
it('tracks code-mark and clear-format transitions before replace', () => {
  const input = 'Keep code\n';
  const mark: CorpusAction = { kind: 'toggleMark', range: { text: 'code' }, mark: 'code' };
  expect(evaluate(input, 'Keep `code`\n', [mark, replaceCode])).not.toThrow();
  expect(evaluate(input, 'Keep `LOST`\n', [mark, replaceCode])).toThrow('a-sequence-model');
  expect(evaluate('Keep `code`\n', 'Keep LOST\n', [{ kind: 'clearFormat', range: { text: 'code' } }, replaceCode])).not.toThrow();
});
it('pastes HTML table cells into a range in row order', () => {
  const input = '| A | B |\n| --- | --- |\n| C | D |\n';
  const action: CorpusAction = { kind: 'paste', at: { cells: { table: 1, from: [1, 1], to: [2, 2] } },
    html: '<table><tr><td>X</td><td>Y</td></tr><tr><td>Z</td><td>W</td></tr></table>' };
  expect(evaluate(input, '| X | Y |\n| --- | --- |\n| Z | W |\n', action)).not.toThrow();
  expect(evaluate(input, '| X | Z |\n| --- | --- |\n| Y | W |\n', action)).toThrow('a-sequence-model');
});
it('treats an indented code block containing blank lines as one literal block', () => {
  const input = '    left a\n\n    b right\n';
  const action: CorpusAction = { kind: 'delete', range: { text: 'a\n\nb' } };
  expect(evaluate(input, '    left  right\n', action)).not.toThrow();
  expect(evaluate(input, '    left x right\n', action)).toThrow('a-sequence-model');
});
it('models row insertion for a single-column table', () => {
  const input = '| A |\n| --- |\n| B |\n';
  const action: CorpusAction = { kind: 'insertTableRow', at: { cell: { table: 1, row: 2, col: 1 } }, side: 'below' };
  expect(evaluate(input, '| A |\n| --- |\n| B |\n|  |\n', action)).not.toThrow();
});
