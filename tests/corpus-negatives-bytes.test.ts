// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { applyNegative, assertNegative } from './support/corpus/negatives.ts';
import type { ComparisonActual, ComparisonExpected } from './support/corpus/comparator.ts';
import type { MountingRecord } from './support/corpus/types.ts';

/** Today's byte path (negatives.ts before MIG-003c0), kept verbatim as the oracle the new path must equal. */
function bufferOracle(text: string, offset = 0, replacement?: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) throw new Error('negative byte offset out of bounds');
  const inserted = Buffer.from(replacement ?? (bytes[offset] === 88 ? 'Y' : 'X'), 'utf8');
  if (inserted.length !== 1) throw new Error('negative replacement must be exactly one UTF-8 byte');
  bytes[offset] = inserted[0]; return bytes.toString('utf8');
}
const MANIFEST_ROOT = 'tests/fixtures/markdown-corpus';
const base = { caseId: 'a-bytes', category: 'a', status: 'active', actionGroup: 'no-edit', fidelityTag: 'immutable', input: 'i.md',
  expected: { serialized: 'e.md' }, action: [], platform: 'any', baselineSha: 'a'.repeat(40), normalizations: [], rationale: 'r',
  guardedPaths: [], consumers: [] } as unknown as MountingRecord;
const outcome = (run: () => string) => { try { return { value: run() }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; } };
const apply = (negative: MountingRecord['negative'], serialized: string) =>
  applyNegative({ ...base, negative } as MountingRecord, { input: serialized, expectedSerialized: serialized }, { untouched: serialized, serialized }).serialized;

it('every committed byte negative yields the same bytes as the Buffer path on its committed baseline', () => {
  const cases = ['a.json', 'l.json'].flatMap(name => (JSON.parse(readFileSync(`${MANIFEST_ROOT}/${name}`, 'utf8')) as MountingRecord[])
    .filter(r => r.negative.kind === 'alterByte' || (r.negative.kind === 'corruptSerialized' && (r.negative.offset !== undefined || r.negative.with !== undefined))));
  expect(cases.map(r => r.caseId).sort()).toEqual(['a-neighbor-undo', 'l-emoji-edges']);
  for (const r of cases) {
    const serialized = readFileSync(`${MANIFEST_ROOT}/${r.expected.serialized}`, 'utf8');
    const negative = r.negative as { offset?: number; with?: string };
    expect(outcome(() => apply(r.negative, serialized))).toEqual(outcome(() => bufferOracle(serialized, negative.offset, negative.with)));
  }
});

const TEXTS = ['﻿a中👩‍👩‍👧é\n', 'X', 'XY', '﻿a', 'lone \uD800 x', ''];
const REPLACEMENTS = [undefined, 'Y', 'X', '\n', '字', '', 'ab'];
const byteVectors = TEXTS.flatMap(text => [-1, NaN, 0.5, undefined, ...Array.from({ length: new TextEncoder().encode(text).length + 1 }, (_, i) => i)]
  .flatMap(offset => REPLACEMENTS.map(replacement => ({ text, offset, replacement }))));

it.each(['alterByte', 'corruptSerialized'] as const)('%s equals the Buffer path at every offset, replacement and out-of-range input, BOM kept', kind => {
  const actual = byteVectors.map(({ text, offset, replacement }) => outcome(() => apply({ kind, offset, with: replacement } as MountingRecord['negative'], text)));
  // corruptSerialized with neither offset nor with appends a marker instead of altering a byte (negatives.ts:22-23).
  const marked = (offset?: number, replacement?: string) => kind === 'corruptSerialized' && offset === undefined && replacement === undefined;
  const expected = byteVectors.map(({ text, offset, replacement }) => outcome(() => marked(offset, replacement)
    ? text + '\n__CORRUPTED_SERIALIZED__\n' : bufferOracle(text, offset, replacement)))
    .map(result => 'error' in result ? { error: `a-bytes: ${result.error}` } : result);
  expect(actual).toEqual(expected);
  expect(apply({ kind, offset: 3 } as MountingRecord['negative'], '﻿a')).toBe('﻿X');
});

it('assertNegative keeps its milkdown default engine and three-parameter arity', () => {
  const r = { ...base, negative: { kind: 'corruptSerialized' } } as MountingRecord;
  const expected: ComparisonExpected = { input: 'A\n', expectedSerialized: 'A\n' }, actual: ComparisonActual = { untouched: 'A\n', serialized: 'A\n' };
  expect([applyNegative.length, assertNegative.length]).toEqual([3, 3]);
  expect(outcome(() => { assertNegative(r, expected, actual); return 'passed'; })).toEqual(outcome(() => { assertNegative(r, expected, actual, 'milkdown'); return 'passed'; }));
});
