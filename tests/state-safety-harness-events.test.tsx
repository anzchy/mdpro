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
