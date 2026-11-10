import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-CS pins the current App outcome when the real serializer throws during save', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    await journey.type('X');
    const before = journey.readTokens(id);
    journey.breakSerializer();
    await journey.menu('file.save');
    expect(journey.readTokens(id)).toEqual(before);
    expect(journey.boundary.calls.filter(call => ['save_file', 'save_file_dialog'].includes(call.command))).toEqual([]);
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.boundary.corpus.files.get(path)).toBe(content);
    expect(journey.documentStore.getState().getDocumentById(id)).toMatchObject({ content, savedContent: content, isModified: true });
    expect(journey.toastStore.getState().message).toMatch(/^Save failed:/);
  } finally { await journey.cleanup(); }
}, 15_000);
