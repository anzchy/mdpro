import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C4 refuses a save when the real serializer fails', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    journey.breakSerializer();
    const toastStart = journey.toastHistory.length;
    const logStart = journey.boundary.logs.length;
    const transitionStart = journey.transitions.length;
    await journey.menu('file.save');
    expect(journey.toastHistory.slice(toastStart)).toEqual([expect.stringMatching(/^Save failed:/)]);
    expect(journey.boundary.logs.slice(logStart).filter(log => log.event === 'file.save')).toEqual([
      expect.objectContaining({ status: 'fail', context: expect.objectContaining({ documentId: id, cause: 'flush-failed' }) }),
    ]);
    expect(journey.boundary.logs.slice(logStart).filter(log =>
      String(log.event).startsWith('file.save') && log.status === 'success')).toEqual([]);
    expect(journey.transitions.slice(transitionStart).every(step => step.documents.find(doc => doc.id === id)?.isModified !== false)).toBe(true);
    expect(journey.boundary.calls.filter(call => ['save_file', 'save_file_dialog'].includes(call.command))).toEqual([]);
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.boundary.corpus.files.get(path)).toBe(content);
    expect(journey.documentStore.getState().getDocumentById(id)?.isModified).toBe(true);
    expect(journey.documentStore.getState().getDocumentById(id)?.savedContent).toBe(content);
    expect(journey.toastStore.getState().message).toMatch(/^Save failed:/);
    expect(journey.readTokens(id)).toEqual(before);
    await journey.advance(250);
    expect(journey.toastHistory.slice(toastStart)).toEqual([expect.stringMatching(/^Save failed:/)]);
    expect(journey.boundary.logs.slice(logStart).filter(log => log.event === 'file.save')).toEqual([
      expect.objectContaining({ status: 'fail' }),
    ]);
    expect(journey.boundary.logs.slice(logStart).filter(log =>
      String(log.event).startsWith('file.save') && log.status === 'success')).toEqual([]);
    expect(journey.transitions.slice(transitionStart).every(step => step.documents.find(doc => doc.id === id)?.isModified !== false)).toBe(true);
    expect(journey.boundary.calls.filter(call => ['save_file', 'save_file_dialog'].includes(call.command))).toEqual([]);
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.documentStore.getState().getDocumentById(id)?.isModified).toBe(true);
    expect(journey.readTokens(id)).toEqual(before);
    expect(journey.toastStore.getState().message).not.toBe('Saved');
  } finally { journey.toastStore.getState().clearToast(); await journey.cleanup(); }
}, 15_000);

it('a-C4 never reports a second failed save as success', async () => {
  const journey = await createAppJourney();
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    journey.breakSerializer();
    const toastStart = journey.toastHistory.length;
    const logStart = journey.boundary.logs.length;
    const transitionStart = journey.transitions.length;
    await journey.menu('file.save');
    const firstToasts = journey.toastHistory.slice(toastStart);
    const firstLogs = journey.boundary.logs.slice(logStart).filter(log => log.event === 'file.save');
    expect(firstToasts).toEqual([expect.stringMatching(/^Save failed:/)]);
    expect(firstLogs).toEqual([expect.objectContaining({ status: 'fail' })]);
    await journey.menu('file.save');
    await journey.advance(250);
    expect(journey.toastHistory.slice(toastStart)).toEqual([
      expect.stringMatching(/^Save failed:/), expect.stringMatching(/^Save failed:/),
    ]);
    expect(journey.boundary.logs.slice(logStart).filter(log => log.event === 'file.save')).toEqual([
      expect.objectContaining({ status: 'fail' }), expect.objectContaining({ status: 'fail' }),
    ]);
    expect(journey.boundary.logs.slice(logStart).filter(log =>
      String(log.event).startsWith('file.save') && log.status === 'success')).toEqual([]);
    expect(journey.transitions.slice(transitionStart).every(step => step.documents.find(doc => doc.id === id)?.isModified !== false)).toBe(true);
    expect(journey.boundary.calls.filter(call => ['save_file', 'save_file_dialog'].includes(call.command))).toEqual([]);
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.boundary.corpus.files.get(path)).toBe(content);
    expect(journey.toastStore.getState().message).toMatch(/^Save failed:/);
    expect(journey.documentStore.getState().getDocumentById(id)?.isModified).toBe(true);
    expect(journey.documentStore.getState().getDocumentById(id)?.savedContent).toBe(content);
    expect(journey.readTokens(id)).toEqual(before);
  } finally { journey.toastStore.getState().clearToast(); await journey.cleanup(); }
}, 15_000);
