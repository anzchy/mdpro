import { act } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H5 captures App quit reply with the matching request', async () => {
  const journey = await createAppJourney();
  try {
    await act(async () => { journey.boundary.emit('app:quit-requested', { requestId: 71, round: 1 }, true); });
    await journey.flushMicrotasks();
    expect(journey.boundary.replies).toContainEqual({ command: 'quit_guard_reply', args: expect.objectContaining({ requestId: 71, round: 1, answer: 'clean' }) });
  } finally { await journey.cleanup(); }
}, 15_000);

it('H5 routes window and global emissions to both scoped and Any listeners', async () => {
  const { AppJourneyBoundary } = await import('./helpers/appJourneyBoundary');
  const boundary = new AppJourneyBoundary();
  const received: string[] = [];
  const stopAny = await boundary.listen('cross:route', () => received.push('any'));
  const stopWindow = await boundary.listen('cross:route', () => received.push('window'), true);
  boundary.emit('cross:route', { n: 1 }, true);
  boundary.emit('cross:route', { n: 2 });
  expect(received.slice(0, 2).sort()).toEqual(['any', 'window']);
  expect(received.slice(2, 4).sort()).toEqual(['any', 'window']);
  stopAny(); stopWindow();
  expect(boundary.liveListeners).toBe(0);
});

it('H5 awaits close listener cancellation', async () => {
  const { AppJourneyBoundary } = await import('./helpers/appJourneyBoundary');
  const boundary = new AppJourneyBoundary();
  const stop = await boundary.onCloseRequested(async event => {
    await Promise.resolve();
    event.preventDefault();
  });
  expect(await boundary.requestClose()).toEqual({ prevented: true });
  stop();
  expect(boundary.liveListeners).toBe(0);
});
