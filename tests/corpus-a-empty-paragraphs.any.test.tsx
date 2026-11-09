/** Category a uses the production editor; every case compares original and serialized bytes and proves its negative. */
Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
import { collectionCases } from './support/collectionCases';
const { expect, it } = await import('vitest');
const { resolve, isAbsolute } = await import('node:path');
const { loadCorpus } = await import('../scripts/corpus/core.ts');
const { runCase, selectCases } = await import('./support/corpus/runner.ts');
// Match the driver tests: install the boundary before the production editor module is loaded.
const { FakeTauriBoundary } = await import('./support/corpus/fakeBoundary.ts');
const { installCorpusBoundary } = await import('./support/corpus/boundaryMocks.ts');
installCorpusBoundary(new FakeTauriBoundary());
await import('./support/corpus/milkdownDriver.tsx');
const write = process.env.CORPUS_WRITE === '1';
if (write && Object.hasOwn(process.env, 'CI')) throw new Error('corpus write mode refused while CI is set');
const data = loadCorpus(resolve(process.env.CORPUS_ROOT ?? 'tests/fixtures/markdown-corpus'));
const caseIds: string[] | undefined = process.env.CORPUS_CASE_IDS ? JSON.parse(process.env.CORPUS_CASE_IDS) : undefined;
const observations: Record<string, import('./support/corpus/types.ts').ObservationKind[]> =
  process.env.CORPUS_OBSERVATIONS ? JSON.parse(process.env.CORPUS_OBSERVATIONS) : {};
const records = selectCases(data.records, { caseIds, platform: 'any', includeLocalOnly: write })
  .filter(record => record.category === 'a');
for (const record of collectionCases('category-a empty paragraphs', records)) {
  it(record.caseId, async () => {
    const result = await runCase(record, data.files, { mode: write ? 'write' : 'check', observationKinds: observations[record.caseId] });
    expect(result.caseKind).toBe('mounting');
    if (record.caseKind === 'guard-only' || result.caseKind !== 'mounting') throw new Error(`${record.caseId}: wrong case kind in category a`);
    expect(result.actual.untouched, `${record.caseId}: untouched bytes`).toBe(data.files[record.input]);
    if (write) {
      const scratch = process.env.CORPUS_SCRATCH;
      if (!scratch || !isAbsolute(scratch)) throw new Error(`${record.caseId}: absolute CORPUS_SCRATCH is required`);
      const { writeScratchResult } = await import('../scripts/corpus/scratch.ts');
      writeScratchResult(scratch, record, result);
    } else {
      expect(result.actual.serialized, `${record.caseId}: serialized bytes`).toBe(data.files[record.expected.serialized]);
    }
  });
}
export {};
