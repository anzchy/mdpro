import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H4 delivers a scripted open-dialog answer to App', async () => {
  const journey = await createAppJourney();
  try {
    const path = '/tmp/mig002/dialog.md';
    journey.boundary.corpus.seed(path, 'from dialog\n');
    journey.boundary.scriptDialog('open', path);
    await journey.menu('file.open');
    expect(journey.boundary.calls.some(call => call.command === 'open_file_dialog')).toBe(true);
    expect(journey.documentStore.getState().documents).toMatchObject([{ path, content: 'from dialog\n' }]);
    expect(journey.boundary.writeLog).toEqual([]);
  } finally { await journey.cleanup(); }
}, 15_000);

it('H14 uses the scripted native save-dialog path for a write', async () => {
  const { AppJourneyBoundary } = await import('./helpers/appJourneyBoundary');
  const boundary = new AppJourneyBoundary();
  boundary.scriptDialog('save', '/tmp/mig002/scripted-save.md');
  const result = await boundary.invoke('save_file_dialog', { documentId: 'd1', content: 'new\n' });
  expect(result).toMatchObject({ path: '/tmp/mig002/scripted-save.md' });
  expect(boundary.writeLog).toEqual([{
    command: 'save_file_dialog', documentId: 'd1', path: '/tmp/mig002/scripted-save.md',
    content: 'new\n', bytes: [...new TextEncoder().encode('new\n')],
  }]);
});
