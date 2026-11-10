// @vitest-environment node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadInWindowRealm, NODE_ONLY_ABSENT, settle } from './helpers/corpusBrowserBundle.ts';
import type { runCase, selectCases } from './support/corpus/runner.ts';
import type { CorpusDriver, GuardOnlyRecord, MountingRecord } from './support/corpus/types.ts';

type Runner = { runCase: typeof runCase; selectCases: typeof selectCases };
const ENTRY = 'tests/support/corpus/runner.ts';
const loading = settle(loadInWindowRealm<Runner>(ENTRY));
const recipe = '{"text":"x","repeat":3}';
const guard: GuardOnlyRecord = { caseId: 'm-guard', category: 'm', caseKind: 'guard-only', status: 'active', recipe: { path: 'guard-only/m/recipe.json', sha256: createHash('sha256').update(recipe).digest('hex') }, viewMode: 'wysiwyg', expected: { observation: { action: 'allow' } }, negative: { kind: 'wrongObservation' }, baselineSha: 'a'.repeat(40), rationale: 'Guard requires no editor.', guardedPaths: [{ path: 'src/utils/largeDocumentGuard.ts', receipt: 'MIG001-m-guard' }], consumers: [] };
const guardFiles = { 'guard-only/m/recipe.json': recipe };
const record: MountingRecord = { caseId: 'a-runner', category: 'a', status: 'active', actionGroup: 'no-edit', fidelityTag: 'immutable',
  input: 'no-edit/a/input.md', expected: { serialized: 'no-edit/a/expected.md' }, action: [], platform: 'any',
  baselineSha: 'a'.repeat(40), normalizations: [], rationale: 'Runner enforces captured bytes.',
  guardedPaths: [{ path: 'src/empty.ts', receipt: 'MIG001-a-empty' }], consumers: [], negative: { kind: 'dropText', text: 'beta' } };
const files = { 'no-edit/a/input.md': 'A beta\n', 'no-edit/a/expected.md': 'A beta\n' };
function fakeDrivers() {
  const events: string[] = [];
  const create = (): CorpusDriver => ({
    async mount() { events.push('mount'); }, async untouched() { return 'A beta\n'; }, async serialize() { return 'A beta\n'; },
    async runAction() { events.push('action'); }, async observe() { return undefined as never; }, async cleanup() { events.push('cleanup'); },
  });
  return { events, driverFactories: { milkdown: create } };
}
// The browser realm's Error is not this realm's Error, so the message is read structurally.
const settled = async (run: () => Promise<unknown>) => { try { return { value: await run() }; } catch (error) { return { error: String((error as { message?: unknown }).message) }; } };
const allow = { caseId: 'm-guard', caseKind: 'guard-only', actual: { observation: { action: 'allow' } }, report: {} };

it('runner.ts runs cases in a browser window realm with no process, Buffer or require, taking its environment from options.env or none', async () => {
  const { module, failure } = await loading;
  expect(failure).toBeUndefined();
  expect(module!.inputs.filter(input => input.startsWith('node:'))).toEqual([]);
  expect(module!.nodeOnlyGlobals).toBe(NODE_ONLY_ABSENT);
  expect(Object.keys(module!.exports).sort()).toEqual(['runCase', 'selectCases']);
  expect([module!.exports.runCase.length, module!.exports.selectCases.length]).toEqual([2, 1]);
  const { runCase: browserRun } = module!.exports, drivers = fakeDrivers();
  expect(await settled(() => browserRun(guard, guardFiles))).toEqual({ value: allow });
  expect(await settled(() => browserRun(guard, guardFiles, { mode: 'write' }))).toEqual({ value: allow });
  expect(await settled(() => browserRun(guard, guardFiles, { mode: 'write', env: { CI: '1' } }))).toEqual({ error: 'm-guard: write mode refused while CI is set' });
  expect(await settled(() => browserRun(record, files, { driverFactories: drivers.driverFactories }))).toEqual({ value: { caseId: 'a-runner', caseKind: 'mounting', actual: { untouched: 'A beta\n', serialized: 'A beta\n' }, report: {} } });
  expect(drivers.events).toEqual(['mount', 'cleanup']);
});

it('no corpus module reads process at import, and a caller passing env never reads it', async () => {
  let reads = 0;
  const loaded = await loadInWindowRealm<Runner>(ENTRY, window => Object.defineProperty(window, 'process', { configurable: true, get() { reads++; return { env: {} }; } }));
  const afterImport = reads;
  expect(await settled(() => loaded.exports.runCase(guard, guardFiles, { env: {} }))).toEqual({ value: allow });
  expect([afterImport, reads]).toEqual([0, 0]);
});

it('nothing in the shared corpus support imports the Node-only browser-realm helper', () => {
  const sources = readdirSync('tests/support/corpus').map(name => readFileSync(`tests/support/corpus/${name}`, 'utf8'));
  expect(sources.filter(source => source.includes('corpusBrowserBundle'))).toEqual([]);
});
