// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadInBareRealm, NODE_ONLY_ABSENT, settle } from './helpers/corpusBrowserBundle.ts';
import type { applyNegative, assertNegative } from './support/corpus/negatives.ts';
import type { MountingRecord } from './support/corpus/types.ts';

type Negatives = { applyNegative: typeof applyNegative; assertNegative: typeof assertNegative };
const loading = settle(loadInBareRealm<Negatives>('tests/support/corpus/negatives.ts'));
/** Today's byte path (negatives.ts before MIG-003c0), run in this Node realm as the oracle for the browser realm. */
function bufferOracle(text: string, offset = 0, replacement?: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) throw new Error('negative byte offset out of bounds');
  const inserted = Buffer.from(replacement ?? (bytes[offset] === 88 ? 'Y' : 'X'), 'utf8');
  if (inserted.length !== 1) throw new Error('negative replacement must be exactly one UTF-8 byte');
  bytes[offset] = inserted[0]; return bytes.toString('utf8');
}
// The browser realm's Error is not this realm's Error, so the message is read structurally.
const outcome = (run: () => string) => { try { return { value: run() }; } catch (error) { return { error: String((error as { message?: unknown }).message) }; } };
const base = { caseId: 'a-bytes', category: 'a', status: 'active', actionGroup: 'no-edit', fidelityTag: 'immutable', input: 'i.md',
  expected: { serialized: 'e.md' }, action: [], platform: 'any', baselineSha: 'a'.repeat(40), normalizations: [], rationale: 'r',
  guardedPaths: [], consumers: [] } as unknown as MountingRecord;
const TEXTS = ['﻿a中👩‍👩‍👧é\n', 'X', 'XY', '﻿a', 'lone \uD800 x', ''];
const REPLACEMENTS = [undefined, 'Y', 'X', '\n', '字', '', 'ab'];
const vectors = TEXTS.flatMap(text => [-1, NaN, 0.5, ...Array.from({ length: new TextEncoder().encode(text).length + 1 }, (_, i) => i)]
  .flatMap(offset => REPLACEMENTS.map(replacement => ({ text, offset, replacement }))));

it('negatives.ts runs in a realm with no Buffer, process or require, with its exports unchanged, byte-identical to the Buffer path', async () => {
  const { module, failure } = await loading;
  expect(failure).toBeUndefined();
  expect(module!.nodeOnlyGlobals).toBe(NODE_ONLY_ABSENT);
  expect(Object.keys(module!.exports).sort()).toEqual(['applyNegative', 'assertNegative']);
  expect([module!.exports.applyNegative.length, module!.exports.assertNegative.length]).toEqual([3, 3]);
  const apply = (negative: MountingRecord['negative'], serialized: string) => module!.exports.applyNegative({ ...base, negative } as MountingRecord,
    { input: serialized, expectedSerialized: serialized }, { untouched: serialized, serialized }).serialized;
  for (const kind of ['alterByte', 'corruptSerialized'] as const) {
    expect(vectors.map(({ text, offset, replacement }) => outcome(() => apply({ kind, offset, with: replacement } as MountingRecord['negative'], text))))
      .toEqual(vectors.map(({ text, offset, replacement }) => outcome(() => bufferOracle(text, offset, replacement)))
        .map(result => 'error' in result ? { error: `a-bytes: ${result.error}` } : result));
  }
  const bom = apply({ kind: 'alterByte', offset: 3 }, '﻿a');
  expect([bom, bom.charCodeAt(0)]).toEqual(['﻿X', 0xfeff]);
});

it('the module source names no Buffer', () => {
  expect(readFileSync('tests/support/corpus/negatives.ts', 'utf8').match(/\bBuffer\b/g) ?? []).toEqual([]);
});
