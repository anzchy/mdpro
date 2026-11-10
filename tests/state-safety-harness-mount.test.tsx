import { EditorStatus } from '@milkdown/kit/core';
import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H11 mounts the real App Milkdown editor under fake time', async () => {
  const journey = await createAppJourney();
  try {
    await journey.openCase('a-one-blank');
    expect(journey.view.container.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(journey.editor().status).toBe(EditorStatus.Created);
    expect(journey.mountMs).toBeGreaterThan(0);
    expect(journey.mountMs).toBeLessThan(5_000);
  } finally { await journey.cleanup(); }
}, 15_000);
