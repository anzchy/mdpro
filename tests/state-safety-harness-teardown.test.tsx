import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H7 rejects a non-Milkdown timer left after unmount', async () => {
  const journey = await createAppJourney();
  setTimeout(() => {}, 10_000);
  await expect(journey.cleanup()).rejects.toThrow(/journey leaked timers=[1-9]/);
}, 15_000);

it('H7 rejects a live event listener left after unmount', async () => {
  const journey = await createAppJourney();
  await journey.boundary.listen('leak:probe', () => {});
  await expect(journey.cleanup()).rejects.toThrow(/listeners=[1-9].*leak:probe/);
}, 15_000);

it('H7 rejects a registered flusher left after unmount', async () => {
  const journey = await createAppJourney();
  journey.milkdownStore.getState().registerFlusher('leak', () => ({ status: 'clean' }));
  await expect(journey.cleanup()).rejects.toThrow(/flushers=[1-9]/);
}, 15_000);
