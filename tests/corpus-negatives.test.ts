import { expect, it } from 'vitest';
import { applyNegative, assertNegative } from './support/corpus/negatives.ts';
import type { MountingRecord } from './support/corpus/types.ts';
import type { ComparisonActual, ComparisonExpected } from './support/corpus/comparator.ts';
const record: MountingRecord = { caseId: 'a-negative', category: 'a', status: 'active', actionGroup: 'no-edit', fidelityTag: 'immutable',
  input: 'no-edit/a/input.md', expected: { serialized: 'no-edit/a/expected.md' }, action: [], platform: 'any',
  baselineSha: 'a'.repeat(40), normalizations: [], rationale: 'Negative dimension conservation.',
  guardedPaths: [{ path: 'src/empty.ts', receipt: 'MIG001-a-empty' }], consumers: [], negative: { kind: 'dropText', text: 'beta' } };
const expected: ComparisonExpected = { input: 'A beta\n', expectedSerialized: 'A beta\n', expectedObservation: { selection: { text: '' } } };
const actual: ComparisonActual = { untouched: 'A beta\n', serialized: 'A beta\n', observation: { selection: { text: '' } } };
it.each([
  [{ kind: 'dropText', text: 'beta' }, 'A \n'],
  [{ kind: 'alterByte', offset: 2, with: 'B' }, 'A Beta\n'],
  [{ kind: 'corruptSerialized', offset: 0, with: 'Z' }, 'Z beta\n'],
] as const)('%s changes only serialized bytes and makes the original comparison fail', (negative, serialized) => {
  const source = structuredClone(actual), r = { ...record, negative } as MountingRecord;
  expect(applyNegative(r, expected, source)).toEqual({ ...actual, serialized });
  expect(source).toEqual(actual); expect(() => assertNegative(r, expected, source)).not.toThrow();
});
it('corruptSerialized preserves independently observed data by value without aliasing', () => {
  const corrupted = applyNegative({ ...record, negative: { kind: 'corruptSerialized' } }, expected, actual);
  expect(corrupted.untouched).toBe(actual.untouched); expect(corrupted.observation).toEqual(actual.observation);
  expect(corrupted.serialized).not.toBe(actual.serialized);
  corrupted.observation!.selection!.text = 'changed'; expect(actual.observation!.selection!.text).toBe('');
});
it('wrongObservation changes only the observation', () => {
  const r = { ...record, negative: { kind: 'wrongObservation', value: { selection: { text: 'wrong' } } } } as MountingRecord;
  expect(applyNegative(r, expected, actual)).toEqual({ ...actual, observation: { selection: { text: 'wrong' } } });
  expect(() => assertNegative(r, expected, actual)).not.toThrow();
});
it('a desired negative fails against the baseline even during an alternate-engine run', () => {
  const r: MountingRecord = { ...record, fidelityTag: 'known-limitation', desired: 'no-edit/a/desired.md', limitRef: 'ADR-0091 C7', reason: 'Separate lists merge.', negative: { kind: 'matchDesiredOnBaseline' } };
  const e = { ...expected, desired: 'Desired\n' };
  expect(applyNegative(r, e, actual)).toEqual({ ...actual, serialized: 'Desired\n' });
  expect(() => assertNegative(r, e, actual, 'alternate')).not.toThrow();
});
it.each([
  { kind: 'dropText', text: 'missing' }, { kind: 'alterByte', offset: -1 },
  { kind: 'alterByte', offset: 999 }, { kind: 'alterByte', offset: NaN },
  { kind: 'alterByte', offset: 0.5 }, { kind: 'alterByte', with: '字' },
] as const)('rejects an invalid negative payload without changing its input %j', negative => {
  const source = structuredClone(actual);
  expect(() => applyNegative({ ...record, negative } as MountingRecord, expected, source)).toThrow('a-negative');
  expect(source).toEqual(actual);
});
it('rejects a negative that changes nothing instead of reporting false evidence', () => {
  const r = { ...record, negative: { kind: 'wrongObservation', value: actual.observation } } as MountingRecord;
  expect(() => assertNegative(r, expected, actual)).toThrow(/a-negative.*negative/i);
});
