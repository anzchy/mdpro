/** Category l uses the production editor; every emoji, CJK and encoding case compares original and serialized bytes and proves its negative. */
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
const bootstrapSerialized: string[] = process.env.CORPUS_BOOTSTRAP_SERIALIZED ? JSON.parse(process.env.CORPUS_BOOTSTRAP_SERIALIZED) : [];
const records = selectCases(data.records, { caseIds, platform: 'any', includeLocalOnly: write })
  .filter(record => record.category === 'l');
const BOM = '﻿';
// A re-saved fixture can lose the very code points its case is about and still pass byte equality, so these cases pin their own subject.
const fixtureSubjects: Record<string, (input: string, desired: string | undefined, expected: string) => void> = {
  'l-leading-bom': (input, desired, expected) => {
    expect(input.startsWith(BOM), 'l-leading-bom: input starts with U+FEFF').toBe(true);
    expect(desired, 'l-leading-bom: desired equals input').toBe(input);
    expect(expected.startsWith(BOM), 'l-leading-bom: expected has no U+FEFF').toBe(false);
  },
  'l-leading-bom-edit': (input, desired, expected) => {
    expect([input.startsWith(BOM), desired?.startsWith(BOM), expected.startsWith(BOM)], 'l-leading-bom-edit: BOM in input and desired only').toEqual([true, true, false]);
  },
  'l-combining-marks': input => {
    expect(['é', '가', 'é', '가'].map(text => input.includes(text)), 'l-combining-marks: both forms present').toEqual([true, true, true, true]);
    expect([input === input.normalize('NFC'), input === input.normalize('NFD')], 'l-combining-marks: neither NFC nor NFD').toEqual([false, false]);
  },
  'l-emoji-flags-keycaps': input => {
    expect(['❤︎', '❤️'].map(text => input.includes(text)), 'l-emoji-flags-keycaps: VS15 and VS16 present').toEqual([true, true]);
  },
};
for (const record of collectionCases('category-l unicode and encodings', records)) {
  it(record.caseId, async () => {
    const mounting = record.caseKind === 'guard-only' ? undefined : record;
    if (!write && mounting) fixtureSubjects[mounting.caseId]?.(data.files[mounting.input], mounting.desired === undefined ? undefined : data.files[mounting.desired], data.files[mounting.expected.serialized]);
    const result = await runCase(record, data.files, { mode: write ? 'write' : 'check', observationKinds: observations[record.caseId], bootstrapSerialized: bootstrapSerialized.includes(record.caseId) });
    expect(result.caseKind).toBe('mounting');
    if (record.caseKind === 'guard-only' || result.caseKind !== 'mounting') throw new Error(`${record.caseId}: wrong case kind in category l`);
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
