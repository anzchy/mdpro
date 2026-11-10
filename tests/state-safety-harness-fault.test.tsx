import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H8 real serializer failure is healed by removing the invalid list', async () => {
  const journey = await createAppJourney();
  try {
    const { id } = await journey.openCase('a-neighbor-edit');
    await journey.type('X');
    journey.breakSerializer();
    expect(journey.milkdownStore.getState().flushPendingEdits('harness-probe').status).toBe('failed');
    journey.healSerializer();
    expect(journey.milkdownStore.getState().flushPendingEdits('harness-probe').status).not.toBe('failed');
    expect(journey.documentStore.getState().getDocumentById(id)?.content).toContain('bX');
  } finally { await journey.cleanup(); }
}, 15_000);
