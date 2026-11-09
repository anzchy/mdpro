import { expect, it } from 'vitest';
import { compareCase } from './support/corpus/comparator.ts';
import type { CorpusAction, MountingRecord } from './support/corpus/types.ts';
function table(rows: string[][]) { return rows.map((row, index) => '| ' + row.join(' | ') + ' |\n' + (index === 0 ? '| ' + row.map(() => '---').join(' | ') + ' |\n' : '')).join(''); }
const original = [['A', 'B'], ['C', 'D']];
function compare(action: CorpusAction, rows: string[][]) {
  const record: MountingRecord = { caseId: 'a-table-model', category: 'a', actionGroup: 'edited', fidelityTag: 'semantic-roundtrip', status: 'active', input: 'input.md', expected: { serialized: 'expected.md' },
    action, normalizations: [], platform: 'any', baselineSha: 'a'.repeat(40), rationale: 'Preserve table cells.', consumers: [], guardedPaths: [], negative: { kind: 'alterByte' } };
  const input = table(original), serialized = table(rows);
  return () => compareCase(record, { input, expectedSerialized: serialized }, { untouched: input, serialized });
}
for (const row of [1, 2]) for (const side of ['above', 'below'] as const) {
  it(`inserts row ${side} at ${row} and rejects a missing/moved cell`, () => {
    const action: CorpusAction = { kind: 'insertTableRow', at: { cell: { table: 1, row, col: 1 } }, side };
    const expected = original.map(cells => [...cells]); expected.splice(row - 1 + (side === 'below' ? 1 : 0), 0, ['', '']);
    expect(compare(action, expected)).not.toThrow();
    expect(compare(action, original)).toThrow('a-table-model');
    const wrong = original.map(cells => [...cells]); wrong.splice(row - 1 + (side === 'above' ? 1 : 0), 0, ['', '']);
    expect(compare(action, wrong)).toThrow('a-table-model');
  });
}
for (const col of [1, 2]) for (const side of ['left', 'right'] as const) {
  it(`inserts column ${side} at ${col} without changing original cells`, () => {
    const action: CorpusAction = { kind: 'insertTableColumn', at: { cell: { table: 1, row: 1, col } }, side };
    const expected = original.map(cells => { const next = [...cells]; next.splice(col - 1 + (side === 'right' ? 1 : 0), 0, ''); return next; });
    expect(compare(action, expected)).not.toThrow();
    expect(compare(action, original)).toThrow('a-table-model');
    const wrong = original.map(cells => { const next = [...cells]; next.splice(col - 1 + (side === 'left' ? 1 : 0), 0, ''); return next; });
    expect(compare(action, wrong)).toThrow('a-table-model');
  });
}
it('fills a cell range in reading order and retains cells outside it', () => {
  const action: CorpusAction = { kind: 'paste', at: { cells: { table: 1, from: [1, 1], to: [2, 2] } }, text: 'X\tY\nZ\tW' };
  expect(compare(action, [['X', 'Y'], ['Z', 'W']])).not.toThrow();
  expect(compare(action, [['X', 'Z'], ['Y', 'W']])).toThrow('a-table-model');
  const one: CorpusAction = { kind: 'paste', at: { cells: { table: 1, from: [2, 2], to: [2, 2] } }, text: 'X' };
  expect(compare(one, [['A', 'B'], ['C', 'X']])).not.toThrow();
  expect(compare(one, [['A', 'B'], ['changed', 'X']])).toThrow('a-table-model');
});
it('repeats one plain pasted value across a cell range and refuses other mismatched counts', () => {
  const repeated: CorpusAction = { kind: 'paste', at: { cells: { table: 1, from: [1, 1], to: [2, 2] } }, text: 'X' };
  expect(compare(repeated, [['X', 'X'], ['X', 'X']])).not.toThrow();
  expect(compare(repeated, [['X', 'X'], ['X', 'wrong']])).toThrow('a-table-model');
  const untileable: CorpusAction = { ...repeated, text: 'X\tY\tZ' };
  expect(compare(untileable, [['X', 'X'], ['X', 'X']])).toThrow('anchor paste cell count mismatch');
});
it('rejects out-of-bounds/reversed cell coordinates and unsupported cell breaks', () => {
  const bad: CorpusAction[] = [
    { kind: 'insertTableRow', at: { cell: { table: 2, row: 1, col: 1 } }, side: 'above' },
    { kind: 'insertTableRow', at: { cell: { table: 1, row: 3, col: 1 } }, side: 'above' },
    { kind: 'insertTableColumn', at: { cell: { table: 1, row: 1, col: 3 } }, side: 'left' },
    { kind: 'paste', at: { cells: { table: 1, from: [2, 2], to: [1, 1] } }, text: 'X' },
    { kind: 'paste', at: { cells: { table: 1, from: [1, 1], to: [3, 2] } }, text: 'X' },
    { kind: 'type', at: { text: 'A', edge: 'after' }, text: '\nX' },
  ];
  for (const action of bad) expect(compare(action, original)).toThrow('a-table-model');
});
it('preserves exact untouched cell bytes while permitting targeted inline markup', () => {
  const action: CorpusAction = { kind: 'toggleMark', range: { text: 'D' }, mark: 'strong' };
  expect(compare(action, [['A', 'B'], ['C', '**D**']])).not.toThrow();
  expect(compare(action, [['**A**', 'B'], ['C', '**D**']])).toThrow('a-table-model');
  expect(compare(action, [['A', 'B'], ['C', '']])).toThrow('a-table-model');
});
