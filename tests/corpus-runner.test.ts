import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCase, selectCases } from './support/corpus/runner.ts';
import type { CorpusDriver, GuardOnlyRecord, MountingRecord, Observations } from './support/corpus/types.ts';
const record: MountingRecord = { caseId: 'a-runner', category: 'a', status: 'active', actionGroup: 'no-edit', fidelityTag: 'immutable',
  input: 'no-edit/a/input.md', expected: { serialized: 'no-edit/a/expected.md' }, action: [], platform: 'any',
  baselineSha: 'a'.repeat(40), normalizations: [], rationale: 'Runner enforces captured bytes.',
  guardedPaths: [{ path: 'src/empty.ts', receipt: 'MIG001-a-empty' }], consumers: [], negative: { kind: 'dropText', text: 'beta' } };
const files = { 'no-edit/a/input.md': 'A beta\n', 'no-edit/a/expected.md': 'A beta\n' };
/** Public driver seam double: actual editor integration is covered by the WI4 suites. */
function factory(output = 'A beta\n', observation: Observations = { selection: { text: '' } }, failAction = false) {
  const events: string[] = [];
  const create = (): CorpusDriver => {
    let mounted = false;
    return {
      async mount() { if (mounted) throw Error('shared driver reused'); mounted = true; events.push('mount'); },
      async untouched() { return 'A beta\n'; }, async serialize() { return output; },
      async runAction() { events.push('action'); if (failAction) throw Error('action failed'); },
      async observe(kind) { return observation[kind] as never; },
      async cleanup() { mounted = false; events.push('cleanup'); },
    };
  };
  return { events, driverFactories: { milkdown: create, alternate: create } };
}
it('compares mandatory serialization and runs a case negative through a fresh driver', async () => {
  const drivers = factory();
  expect(await runCase(record, files, drivers)).toEqual({ caseId: 'a-runner', caseKind: 'mounting', actual: { untouched: 'A beta\n', serialized: 'A beta\n' }, report: {} });
  expect(drivers.events).toEqual(['mount', 'cleanup']);
});
it('does not accept observation equality as a substitute for serialization', async () => {
  const r = { ...record, expected: { ...record.expected, observation: 'no-edit/a/expected.json' } };
  const source = { ...files, 'no-edit/a/expected.json': '{"selection":{"text":""}}' };
  const drivers = factory('corrupted\n', { selection: { text: '' } });
  await expect(runCase(r, source, drivers)).rejects.toThrow('a-runner'); expect(drivers.events).toEqual(['mount', 'cleanup']);
});
it.each(['no-edit/a/expected.md', 'no-edit/a/expected.json'])('missing expected output %s fails before mounting and writes nothing', async missing => {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-runner-'));
  try {
    writeFileSync(join(dir, 'sentinel'), 'unchanged');
    const source: Record<string, string> = { ...files, 'no-edit/a/expected.json': '{"selection":{"text":""}}' }; delete source[missing];
    const r = { ...record, expected: { ...record.expected, observation: 'no-edit/a/expected.json' } }, drivers = factory();
    await expect(runCase(r, source, drivers)).rejects.toThrow(/a-runner.*missing/i);
    expect(drivers.events).toEqual([]); expect(readdirSync(dir)).toEqual(['sentinel']); expect(readFileSync(join(dir, 'sentinel'), 'utf8')).toBe('unchanged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('rejects an unknown mounting engine without falling back', async () => {
  const drivers = factory(); await expect(runCase(record, files, { ...drivers, engine: 'missing' })).rejects.toThrow(/a-runner.*engine/i); expect(drivers.events).toEqual([]);
});
it.each(['', '1', undefined])('refuses write mode whenever CI is an own key: %s', async CI => {
  const drivers = factory(); await expect(runCase(record, files, { ...drivers, mode: 'write', env: { CI } })).rejects.toThrow(/CI/); expect(drivers.events).toEqual([]);
});
it('write mode bootstraps output without writing or changing the supplied inventory', async () => {
  const source = { 'no-edit/a/input.md': 'A beta\n' }, drivers = factory();
  const r = { ...record, expected: { ...record.expected, observation: 'no-edit/a/expected.json' } };
  const result = await runCase(r, source, { ...drivers, mode: 'write', env: {}, observationKinds: ['selection'] });
  expect(result.actual).toEqual({ untouched: 'A beta\n', serialized: 'A beta\n', observation: { selection: { text: '' } } });
  expect(source).toEqual({ 'no-edit/a/input.md': 'A beta\n' });
});
it('write bootstrap requires observation kinds rather than guessing from a file path', async () => {
  const drivers = factory(), r = { ...record, expected: { ...record.expected, observation: 'no-edit/a/expected.json' } };
  await expect(runCase(r, files, { ...drivers, mode: 'write', env: {} })).rejects.toThrow(/a-runner.*observationKinds/i); expect(drivers.events).toEqual([]);
});
it('fails a declared negative that would pass the comparison', async () => {
  const drivers = factory();
  await expect(runCase({ ...record, negative: { kind: 'alterByte', offset: 0, with: 'A' } }, files, drivers)).rejects.toThrow(/a-runner.*negative/i);
});
it('rejects detected paste hazards even when they equal pinned observations', async () => {
  const r = { ...record, expected: { ...record.expected, observation: 'no-edit/a/expected.json' } };
  const source = { ...files, 'no-edit/a/expected.json': '{"pasteSafety":{"forbiddenFound":["script"]}}' };
  await expect(runCase(r, source, factory('A beta\n', { pasteSafety: { forbiddenFound: ['script'] } }))).rejects.toThrow(/a-runner.*pasteSafety/i);
});
it('content TOC is taken from serialized output, independent of driver observations', async () => {
  const r: MountingRecord = { ...record, fidelityTag: 'known-limitation', desired: 'no-edit/a/desired.md', limitRef: '#721', reason: 'Heading changed.', expected: { ...record.expected, observation: 'no-edit/a/expected.json' }, negative: { kind: 'matchDesiredOnBaseline' } };
  const source = { ...files, 'no-edit/a/expected.md': '# Edited\n', 'no-edit/a/desired.md': 'Desired\n', 'no-edit/a/expected.json': '{"toc":[{"level":1,"text":"Edited","id":"edited"}]}' };
  const result = await runCase(r, source, factory('# Edited\n'));
  expect(result.actual).toEqual({ untouched: 'A beta\n', serialized: '# Edited\n', observation: { toc: [{ level: 1, text: 'Edited', id: 'edited' }] } });
});
it('cleans failed actions and keeps later independent runs deterministic in either order', async () => {
  const r = { ...record, actionGroup: 'interaction', action: { kind: 'find', query: 'beta', caseSensitive: false, wholeWord: false }, expected: { ...record.expected, observation: 'interaction/a/expected.json' }, input: 'interaction/a/input.md' } as MountingRecord;
  r.expected.serialized = 'interaction/a/expected.md';
  const source = { 'interaction/a/input.md': 'A beta\n', 'interaction/a/expected.md': 'A beta\n', 'interaction/a/expected.json': '{"selection":{"text":""}}' };
  const broken = factory('A beta\n', { selection: { text: '' } }, true);
  await expect(runCase(r, source, broken)).rejects.toThrow('action failed'); expect(broken.events).toEqual(['mount', 'action', 'cleanup']);
  const drivers = factory(), second = { ...record, caseId: 'a-second' };
  const forward = [await runCase(record, files, drivers), await runCase(second, files, drivers)];
  const reverse = [await runCase(second, files, drivers), await runCase(record, files, drivers)].reverse(); expect(reverse).toEqual(forward);
  expect(drivers.events).toEqual(['mount', 'cleanup', 'mount', 'cleanup', 'mount', 'cleanup', 'mount', 'cleanup']);
});
it('selects requested active cases and excludes retired/local-only/nonselected cases', () => {
  const records = [record, { ...record, caseId: 'a-other' }, { ...record, caseId: 'a-retired', status: 'retired' as const }, { ...record, caseId: 'a-local', ci: 'local-only' as const }];
  expect(selectCases(records, { caseIds: ['a-runner', 'a-retired', 'a-local'] })).toEqual([record]);
  expect(() => selectCases(records, { caseIds: ['a-missing'] })).toThrow('a-missing');
});
const recipe = '{"text":"x","repeat":3}';
const guard: GuardOnlyRecord = { caseId: 'm-guard', category: 'm', caseKind: 'guard-only', status: 'active', recipe: { path: 'guard-only/m/recipe.json', sha256: createHash('sha256').update(recipe).digest('hex') }, viewMode: 'wysiwyg', expected: { observation: { action: 'allow' } }, negative: { kind: 'wrongObservation' }, baselineSha: 'a'.repeat(40), rationale: 'Guard requires no editor.', guardedPaths: [{ path: 'src/utils/largeDocumentGuard.ts', receipt: 'MIG001-m-guard' }], consumers: [] };
it('guard-only results are engine invariant and need no driver or editor', async () => {
  const first = await runCase(guard, { 'guard-only/m/recipe.json': recipe }, { engine: 'milkdown', driverFactories: {} });
  expect(await runCase(guard, { 'guard-only/m/recipe.json': recipe }, { engine: 'unavailable', driverFactories: {} })).toEqual(first);
  expect(first).toEqual({ caseId: 'm-guard', caseKind: 'guard-only', actual: { observation: { action: 'allow' } }, report: {} });
  expect(document.querySelector('.ProseMirror')).toBeNull();
});
it('guard-only checksum and complete expected decision mismatches fail with the case id', async () => {
  await expect(runCase(guard, { 'guard-only/m/recipe.json': recipe + '\n' })).rejects.toThrow(/m-guard.*sha256/i);
  await expect(runCase({ ...guard, expected: { observation: { action: 'withhold-table-extensions' as const, message: 'wrong', tableRows: 1 } } }, { 'guard-only/m/recipe.json': recipe })).rejects.toThrow('m-guard');
});
it('guard write mode returns a changed candidate without mutating pinned expectations', async () => {
  const r: GuardOnlyRecord = { ...guard, expected: { observation: { action: 'withhold-table-extensions', message: 'old decision', tableRows: 1 } } };
  const source = { 'guard-only/m/recipe.json': recipe }, before = structuredClone(r);
  expect(await runCase(r, source, { mode: 'write', env: {} })).toEqual({ caseId: 'm-guard', caseKind: 'guard-only', actual: { observation: { action: 'allow' } }, report: {} });
  expect(r).toEqual(before); expect(source).toEqual({ 'guard-only/m/recipe.json': recipe });
});
it.each([{ kinds: ['unknown'] }, { kinds: ['selection', 'selection'] }])('write bootstrap rejects nonclosed or duplicate kinds before mounting %j', async ({ kinds }) => {
  const r = { ...record, expected: { ...record.expected, observation: 'no-edit/a/expected.json' } }, drivers = factory();
  await expect(runCase(r, files, { ...drivers, mode: 'write', env: {}, observationKinds: kinds as never })).rejects.toThrow(/a-runner.*observationKinds/i);
  expect(drivers.events).toEqual([]);
});
