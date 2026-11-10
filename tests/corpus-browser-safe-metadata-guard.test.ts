// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { loadInBareRealm, NODE_ONLY_ABSENT, settle } from './helpers/corpusBrowserBundle.ts';
import { guardDecisionValid, guardRecordErrors } from './support/corpus/metadataGuard.ts';

type Guard = { guardDecisionValid: typeof guardDecisionValid; guardRecordErrors: typeof guardRecordErrors };
const loading = settle(loadInBareRealm<Guard>('tests/support/corpus/metadataGuard.ts'));
const path = 'guard-only/m/small.recipe.json';
const recipe = JSON.stringify({ text: '中文\n'.repeat(30), repeat: 4 });
const record = (sha256: string) => ({ caseId: 'm-small', category: 'm', caseKind: 'guard-only', status: 'active', recipe: { path, sha256 },
  viewMode: 'wysiwyg', expected: { observation: { action: 'allow' } }, negative: { kind: 'wrongObservation' } });
const sha = createHash('sha256').update(recipe).digest('hex');

it('metadataGuard.ts loads in a realm with no process, Buffer or require, with its exports unchanged, and checks recipe checksums there as Node does', async () => {
  const { module, failure } = await loading;
  expect(failure).toBeUndefined();
  expect(module!.inputs.filter(input => input.startsWith('node:'))).toEqual([]);
  expect(module!.nodeOnlyGlobals).toBe(NODE_ONLY_ABSENT);
  expect(Object.keys(module!.exports).sort()).toEqual(['guardDecisionValid', 'guardRecordErrors']);
  expect([module!.exports.guardDecisionValid.length, module!.exports.guardRecordErrors.length]).toEqual([1, 2]);
  const inputs: [Record<string, unknown>, Record<string, string>][] = [
    [record(sha), { [path]: recipe }], [record(sha), { [path]: recipe + '\n' }], [record('0'.repeat(64)), { [path]: recipe }], [record(sha), {}],
  ];
  const browser = inputs.map(([r, files]) => module!.exports.guardRecordErrors(r, files));
  expect(browser).toEqual([[], ['recipe sha256 mismatch'], ['recipe sha256 mismatch'], ['recipe missing file']]);
  expect(inputs.map(([r, files]) => guardRecordErrors(r, files))).toEqual(browser);
  expect(module!.exports.guardDecisionValid({ action: 'allow' })).toBe(true);
});
