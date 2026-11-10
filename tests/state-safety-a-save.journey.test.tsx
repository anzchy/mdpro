import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C2 StrictMode Cmd+S saves the latest edit before edit sync', async () => {
  const journey = await createAppJourney({ strictMode: true });
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    expect(journey.documentStore.getState().getDocumentById(id)?.isModified).toBe(true);
    await journey.menu('file.save');
    const expected = content.replace(/b\n$/, 'bX\n');
    const saves = journey.boundary.writeLog.filter(write => write.command === 'save_file');
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] });
    expect(journey.boundary.corpus.files.get(path)).toBe(expected);
    expect(journey.documentStore.getState().getDocumentById(id)).toMatchObject({ content: expected, savedContent: expected, isModified: false });
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    await journey.advance(250);
    expect(journey.boundary.calls.filter(call => call.command === 'save_file')).toHaveLength(1);
    expect(journey.boundary.writeLog.filter(write => write.command === 'save_file')).toHaveLength(1);
    expect(journey.documentStore.getState().getDocumentById(id)?.savedContent).toBe(expected);
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
  } finally { await journey.cleanup(); }
}, 15_000);

it('a-C2 rejects stale bytes after two edits before the sync delay', async () => {
  const journey = await createAppJourney({ strictMode: true });
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    await journey.type('Y');
    await journey.menu('file.save');
    const expected = content.replace(/b\n$/, 'bXY\n');
    expect(journey.boundary.writeLog.filter(write => write.command === 'save_file')).toMatchObject([
      { documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
    ]);
    expect(journey.documentStore.getState().getDocumentById(id)).toMatchObject({ content: expected, savedContent: expected, isModified: false });
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    await journey.advance(250);
    expect(journey.boundary.calls.filter(call => call.command === 'save_file')).toHaveLength(1);
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
  } finally { await journey.cleanup(); }
}, 15_000);
