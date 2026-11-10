import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H7 rejects a non-Milkdown timer left after unmount', async () => {
  const journey = await createAppJourney();
  setTimeout(() => {}, 10_000);
  await expect(journey.cleanup()).rejects.toThrow(/journey leaked timers=[1-9]/);
}, 15_000);

it('H7 rejects a leftover toast timer instead of clearing it before inspection', async () => {
  const journey = await createAppJourney();
  journey.toastStore.getState().showToast('leftover', 600_000);
  await expect(journey.cleanup()).rejects.toThrow(/journey leaked timers=[1-9]/);
}, 15_000);

it('H7 rejects a live event listener left after unmount', async () => {
  const journey = await createAppJourney();
  await journey.boundary.listen('leak:probe', () => {});
  await expect(journey.cleanup()).rejects.toThrow(/listeners=[1-9].*leak:probe/);
}, 15_000);

it('H7 rejects a window DOM listener left after unmount', async () => {
  const journey = await createAppJourney();
  window.addEventListener('keydown', () => {});
  await expect(journey.cleanup()).rejects.toThrow(/domListeners=[1-9].*keydown/);
}, 15_000);

it('H7 rejects a document keydown listener left after unmount', async () => {
  const journey = await createAppJourney();
  document.addEventListener('keydown', () => {});
  await expect(journey.cleanup()).rejects.toThrow(/domListeners=[1-9].*document:keydown/);
}, 15_000);

it('H7 rejects an element listener left on the mounted App root', async () => {
  const journey = await createAppJourney();
  journey.view.container.addEventListener('click', () => {});
  await expect(journey.cleanup()).rejects.toThrow(/domListeners=[1-9].*element:click/);
}, 15_000);

it('H7 rejects a registered flusher left after unmount', async () => {
  const journey = await createAppJourney();
  journey.milkdownStore.getState().registerFlusher('leak', () => ({ status: 'clean' }));
  await expect(journey.cleanup()).rejects.toThrow(/flushers=[1-9]/);
}, 15_000);
