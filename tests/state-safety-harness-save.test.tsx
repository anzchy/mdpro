import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H1 records exact untouched corpus bytes through App save', async () => {
  const journey = await createAppJourney();
  try {
    const opened = await journey.openCase('a-one-blank');
    await journey.menu('file.save');
    const expectedWrites = [
      { command: 'save_file', documentId: opened.id, path: opened.path, content: opened.content,
        bytes: [...new TextEncoder().encode(opened.content)] },
      { command: 'delete_draft', documentId: opened.id, content: '', bytes: [] },
    ];
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
    await journey.advance(250);
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
  } finally {
    const writesBeforeToastExpiry = [...journey.boundary.writeLog];
    try {
      await journey.advance(3_000);
      expect(journey.boundary.writeLog).toEqual(writesBeforeToastExpiry);
    } finally {
      await journey.cleanup();
    }
  }
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
