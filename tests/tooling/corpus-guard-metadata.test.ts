// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { validateRecord } from '../support/corpus/metadata.ts';
const root = mkdtempSync(join(tmpdir(), 'corpus-guard-'));
const recipe = '{"kind":"repeat","text":"A","count":1}\n';
writeFileSync(join(root, 'recipe.json'), recipe);
const bytes = readFileSync(join(root, 'recipe.json'), 'utf8');
const path = 'guard-only/m/small.recipe.json';
const files = { [path]: bytes };
const hash = createHash('sha256').update(bytes).digest('hex');
afterAll(() => rmSync(root, { recursive: true, force: true }));
function record(): Record<string, any> {
  return { caseId: 'm-small', category: 'm', caseKind: 'guard-only', status: 'active',
    recipe: { path, sha256: hash }, viewMode: 'wysiwyg', expected: { observation: { action: 'allow' } },
    negative: { kind: 'wrongObservation' }, baselineSha: 'a'.repeat(40), rationale: 'Small content is allowed.',
    guardedPaths: [{ path: 'src/utils/largeDocumentGuard.ts', receipt: 'MIG001-m-small' }], consumers: ['MIG-009a'] };
}
function rejects(value: unknown, field: string, inventory: Record<string, string> = files) {
  expect(validateRecord(value, { files: inventory }).some(line => line.includes('m-small') && line.includes(field))).toBe(true);
}
it.each(['source', 'wysiwyg'])('accepts complete allow decision in %s', viewMode => {
  expect(validateRecord({ ...record(), viewMode }, { files })).toEqual([]);
});
it.each(['structure', 'line-length', 'both'])('accepts complete degrade arm with %s trigger', trigger => {
  expect(validateRecord({ ...record(), expected: { observation: { action: 'degrade-to-source', message: 'Source mode', elements: 25001, longestLine: 1, trigger } } }, { files })).toEqual([]);
});
it('accepts complete Source table-withhold arm', () => {
  expect(validateRecord({ ...record(), viewMode: 'source', expected: { observation: { action: 'withhold-table-extensions', message: 'Tables withheld', tableRows: 50001 } } }, { files })).toEqual([]);
});
it.each(['recipe', 'viewMode', 'expected', 'negative'])('rejects missing %s', field => {
  const value = record(); delete value[field]; rejects(value, field);
});
it.each([
  { path }, { path, sha256: 'abc' }, { path, sha256: '0'.repeat(64) }, { sha256: hash },
  { path: '../m/small.recipe.json', sha256: hash },
])('rejects invalid recipe %j', recipe => rejects({ ...record(), recipe }, 'recipe'));
it('rejects a missing recipe file', () => rejects(record(), 'recipe', {}));
it('rejects incorrect mode and category', () => {
  rejects({ ...record(), viewMode: 'preview' }, 'viewMode');
  rejects({ ...record(), category: 'a' }, 'category');
});
it.each(['actionGroup', 'fidelityTag', 'action', 'platform', 'normalizations', 'desired', 'limitRef', 'reason', 'input'])('rejects forbidden mounting field %s even when undefined', field => {
  rejects({ ...record(), [field]: undefined }, field);
});
it('rejects serialized output on guard-only', () => {
  rejects({ ...record(), expected: { ...record().expected, serialized: 'x.md' } }, 'serialized');
});
it.each([{ kind: 'alterByte' }, { kind: 'wrongObservation', value: {} }, {}])('requires exactly the guard negative %j', negative => {
  rejects({ ...record(), negative }, 'negative');
});
it.each([
  {}, { action: 'permit' }, { action: 'allow', elements: 1 },
  { action: 'degrade-to-source' }, { action: 'degrade-to-source', message: 'X', elements: 1, longestLine: 2 },
  { action: 'degrade-to-source', message: 'X', elements: 1, longestLine: 2, trigger: 'size' },
  { action: 'withhold-table-extensions' }, { action: 'withhold-table-extensions', tableRows: 50001 },
  { action: 'withhold-table-extensions', message: 'X', tableRows: 50001, elements: 0 },
])('rejects truncated or unknown full decision %j', observation => rejects({ ...record(), expected: { observation } }, 'observation'));
for (const invalid of [-1, 1.5, NaN, Infinity, -Infinity, '1']) {
  it(`rejects invalid decision count ${invalid}`, () => {
    for (const field of ['elements', 'longestLine']) rejects({ ...record(), expected: { observation: {
      action: 'degrade-to-source', message: 'X', elements: 25001, longestLine: 1, trigger: 'structure', [field]: invalid,
    } } }, 'observation');
    rejects({ ...record(), viewMode: 'source', expected: { observation: { action: 'withhold-table-extensions', message: 'X', tableRows: invalid } } }, 'observation');
  });
}
it('retains exact recipe bytes and repeatable validation', () => {
  expect(validateRecord(record(), { files })).toEqual([]);
  expect(validateRecord(record(), { files })).toEqual(validateRecord(record(), { files }));
  expect(readFileSync(join(root, 'recipe.json'), 'utf8')).toBe(recipe);
});
