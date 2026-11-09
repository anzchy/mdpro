// @vitest-environment node
import { expect, it } from 'vitest';
import { validateManifest, validateRecord } from '../support/corpus/metadata.ts';
import { canonicalJson } from '../support/corpus/canonical.ts';
const base = {
  caseId: 'a-shapes', category: 'a', actionGroup: 'no-edit', fidelityTag: 'immutable', status: 'active',
  input: 'no-edit/a/input.md', expected: { serialized: 'no-edit/a/expected.md', observation: 'no-edit/a/expected.json' },
  action: [], platform: 'any', baselineSha: 'a'.repeat(40), normalizations: [], rationale: 'Preserve typed observation payloads.',
  guardedPaths: [{ path: 'src/components/Editor/MilkdownEditor.tsx', receipt: 'MIG001-a-editor' }], negative: { kind: 'wrongObservation' }, consumers: ['MIG-009a'],
};
function context(observation: unknown) {
  return { files: { 'no-edit/a/input.md': 'A\n', 'no-edit/a/expected.md': 'A\n', 'no-edit/a/expected.json': JSON.stringify(observation) } };
}
it.each(['immutable', 'semantic-roundtrip'])('rejects a nonempty action in no-edit %s', fidelityTag => {
  const value = { ...base, fidelityTag, normalizations: fidelityTag === 'immutable' ? [] : ['N4'], action: { kind: 'type', at: { text: 'A', edge: 'after' }, text: 'X' } };
  expect(validateRecord(value, context({ selection: { text: '' } })).some(error => error.includes('a-shapes') && error.includes('no-edit'))).toBe(true);
});
it.each([
  { toc: [{ level: 1, text: 'A' }] }, { toc: [{ level: 0, text: 'A', id: 'a' }] },
  { largeDocGuard: { action: 'degrade-to-source', trigger: 'structure' } },
  { find: { query: 'A', options: { caseSensitive: false }, matches: [] } },
  { find: { query: 'A', options: { caseSensitive: false, wholeWord: false }, matches: [{ text: 'A', occurrence: 0, block: 1 }] } },
  { pasteSafety: { forbiddenFound: 'script' } }, { pasteSafety: { forbiddenFound: [123] } },
  { linkActivation: { outcome: 'refused', defaultPrevented: true, propagated: false, openerCalls: [] } },
  { linkActivation: { outcome: 'external', defaultPrevented: 'true', propagated: true, openerCalls: ['https://example.com/'] } },
  { renderedMath: { count: -1 } }, { renderedMath: { count: 1.5 } },
  { imageSources: [{ markdownSrc: 'a.png', resolvedKind: 'local' }] }, { selection: { text: 1 } },
  {}, [], { selection: null },
])('rejects malformed observation DTO %j', observation => {
  expect(validateRecord(base, context(observation)).some(error => error.includes('a-shapes') && error.includes('observation'))).toBe(true);
});
it('accepts a nonempty map containing multiple complete observations', () => {
  expect(validateRecord(base, context({
    toc: [{ level: 2, text: 'Heading', id: 'heading' }], largeDocGuard: { action: 'allow' },
    find: { query: 'A', options: { caseSensitive: true, wholeWord: false }, matches: [{ text: 'A', occurrence: 1, block: 1 }] },
    pasteSafety: { forbiddenFound: [] }, linkActivation: { outcome: 'refused', reason: 'scheme', defaultPrevented: true, propagated: false, openerCalls: [] },
    renderedMath: { count: 0 }, imageSources: [{ markdownSrc: 'a.png', resolvedKind: 'asset' }], selection: { text: 'A' },
  }))).toEqual([]);
});
it('enforces canonical manifest bytes when supplied by a read-only caller', () => {
  const values = [base];
  const ctx = context({ selection: { text: '' } });
  expect(validateManifest(values, { ...ctx, canonicalSource: canonicalJson(values) })).toEqual([]);
  expect(validateManifest(values, { ...ctx, canonicalSource: JSON.stringify(values) }).some(error => error.includes('canonical'))).toBe(true);
});
it('requires observation output for interaction records', () => {
  const value = { ...base, actionGroup: 'interaction', action: { kind: 'find', query: 'A', caseSensitive: false, wholeWord: false }, input: 'interaction/a/input.md', expected: { serialized: 'interaction/a/expected.md' } };
  expect(validateRecord(value, { files: { 'interaction/a/input.md': 'A\n', 'interaction/a/expected.md': 'A\n' } }).some(error => error.includes('observation'))).toBe(true);
});
