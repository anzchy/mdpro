import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H1 records exact untouched corpus bytes through App save', async () => {
  const journey = await createAppJourney();
  try {
    const opened = await journey.openCase('a-one-blank');
    await journey.menu('file.save');
    const saves = journey.boundary.writeLog.filter(write => write.command === 'save_file');
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ documentId: opened.id, path: opened.path, content: opened.content,
      bytes: [...new TextEncoder().encode(opened.content)] });
  } finally { await journey.cleanup(); }
}, 15_000);

it('H2 opens an untouched corpus case without writing', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-one-blank');
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.boundary.corpus.files.get(path)).toBe(content);
    expect(journey.documentStore.getState().getDocumentById(id)).toMatchObject({ content, savedContent: content, isModified: false });
  } finally { await journey.cleanup(); }
}, 15_000);
