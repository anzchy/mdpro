import { afterEach, expect, it, vi } from 'vitest';
import { runCase } from './support/corpus/runner.ts';
import type { CorpusDriver, MountingRecord } from './support/corpus/types.ts';

const record: MountingRecord = { caseId: 'a-runner', category: 'a', status: 'active', actionGroup: 'no-edit', fidelityTag: 'immutable',
  input: 'no-edit/a/input.md', expected: { serialized: 'no-edit/a/expected.md' }, action: [], platform: 'any',
  baselineSha: 'a'.repeat(40), normalizations: [], rationale: 'Runner enforces captured bytes.',
  guardedPaths: [{ path: 'src/empty.ts', receipt: 'MIG001-a-empty' }], consumers: [], negative: { kind: 'dropText', text: 'beta' } };
const files = { 'no-edit/a/input.md': 'A beta\n', 'no-edit/a/expected.md': 'A beta\n' };
const mounted = { caseId: 'a-runner', caseKind: 'mounting', actual: { untouched: 'A beta\n', serialized: 'A beta\n' }, report: {} };
function engines() {
  const events: Record<string, string[]> = { milkdown: [], other: [] };
  const create = (name: string) => (): CorpusDriver => ({
    async mount() { events[name].push('mount'); }, async untouched() { return 'A beta\n'; }, async serialize() { return 'A beta\n'; },
    async runAction() { events[name].push('action'); }, async observe() { return undefined as never; }, async cleanup() { events[name].push('cleanup'); },
  });
  return { events, driverFactories: { milkdown: create('milkdown'), other: create('other') } };
}
const savedEnv = process.env;
afterEach(() => { process.env = savedEnv; vi.unstubAllEnvs(); });
function envWithout(key: string): NodeJS.ProcessEnv { const env = { ...savedEnv }; delete env[key]; return env; }

it('a Node caller passing no env still reads CI from process.env', async () => {
  vi.stubEnv('CI', '1'); const drivers = engines();
  await expect(runCase(record, files, { ...drivers, mode: 'write' })).rejects.toThrow('a-runner: write mode refused while CI is set');
  expect(drivers.events).toEqual({ milkdown: [], other: [] });
});

it('a Node caller passing no env still takes CORPUS_ENGINE from process.env', async () => {
  vi.stubEnv('CORPUS_ENGINE', 'other'); const drivers = engines();
  expect(await runCase(record, files, drivers)).toEqual(mounted);
  expect(drivers.events).toEqual({ milkdown: [], other: ['mount', 'cleanup'] });
});

it('process.env is read on each call, including after the object itself is replaced', async () => {
  process.env = envWithout('CI'); const drivers = engines();
  expect(await runCase(record, files, { ...drivers, mode: 'write' })).toEqual(mounted);
  process.env = { ...envWithout('CI'), CI: '1' };
  await expect(runCase(record, files, { ...drivers, mode: 'write' })).rejects.toThrow('a-runner: write mode refused while CI is set');
});

it('an explicit env replaces process.env rather than merging with it', async () => {
  vi.stubEnv('CI', '1'); vi.stubEnv('CORPUS_ENGINE', 'other'); const drivers = engines();
  expect(await runCase(record, files, { ...drivers, mode: 'write', env: {} })).toEqual(mounted);
  expect(drivers.events).toEqual({ milkdown: ['mount', 'cleanup'], other: [] });
});
