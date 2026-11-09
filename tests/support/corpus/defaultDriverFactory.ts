/** Lazily select the production adapter after installing its process boundary. No engine types cross the caller seam. */
import type { CorpusDriver, MountingRecord } from './types.ts';
export async function createCorpusDriver(record: MountingRecord): Promise<CorpusDriver> {
  const { FakeTauriBoundary } = await import('./fakeBoundary.ts');
  const { installCorpusBoundary } = await import('./boundaryMocks.ts');
  const boundary = new FakeTauriBoundary(); installCorpusBoundary(boundary);
  const { createMilkdownDriver } = await import('./milkdownDriver.tsx');
  return createMilkdownDriver(boundary, { caseId: record.caseId });
}
