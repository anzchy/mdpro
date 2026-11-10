import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H9 readTokens reports the document lifetime and replacement deltas', async () => {
  const journey = await createAppJourney();
  try {
    const { id } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    await journey.menu('file.save');
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
  } finally { await journey.cleanup(); }
}, 15_000);

it('H10 records each notified document and editor state transition', async () => {
  const journey = await createAppJourney();
  try {
    const { id } = await journey.openCase('a-neighbor-edit');
    const first = journey.transitions.length;
    await journey.type('X');
    await journey.menu('file.save');
    const steps = journey.transitions.slice(first);
    expect(steps.some(step => step.source === 'document' && step.activeId === id && step.documents.some(doc => doc.id === id && doc.dirty))).toBe(true);
    expect(steps.at(-1)?.documents.find(doc => doc.id === id)?.dirty).toBe(false);
  } finally { await journey.cleanup(); }
}, 15_000);
