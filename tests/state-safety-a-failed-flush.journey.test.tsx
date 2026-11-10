import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C4 refuses a save when the real serializer fails', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    journey.breakSerializer();
    await journey.menu('file.save');
    expect(journey.boundary.calls.filter(call => ['save_file', 'save_file_dialog'].includes(call.command))).toEqual([]);
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.boundary.corpus.files.get(path)).toBe(content);
    expect(journey.documentStore.getState().getDocumentById(id)?.isModified).toBe(true);
    expect(journey.documentStore.getState().getDocumentById(id)?.savedContent).toBe(content);
    expect(journey.toastStore.getState().message).toMatch(/^Save failed:/);
    expect(journey.readTokens(id)).toEqual(before);
    await journey.advance(250);
    expect(journey.boundary.calls.filter(call => ['save_file', 'save_file_dialog'].includes(call.command))).toEqual([]);
    expect(journey.documentStore.getState().getDocumentById(id)?.isModified).toBe(true);
    expect(journey.readTokens(id)).toEqual(before);
    expect(journey.toastStore.getState().message).not.toBe('Saved');
  } finally { await journey.cleanup(); }
}, 15_000);

it('a-C4 never reports a second failed save as success', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    journey.breakSerializer();
    await journey.menu('file.save');
    await journey.menu('file.save');
    await journey.advance(250);
    expect(journey.boundary.calls.filter(call => ['save_file', 'save_file_dialog'].includes(call.command))).toEqual([]);
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.boundary.corpus.files.get(path)).toBe(content);
    expect(journey.toastStore.getState().message).toMatch(/^Save failed:/);
    expect(journey.documentStore.getState().getDocumentById(id)?.isModified).toBe(true);
    expect(journey.documentStore.getState().getDocumentById(id)?.savedContent).toBe(content);
    expect(journey.readTokens(id)).toEqual(before);
  } finally { await journey.cleanup(); }
}, 15_000);
