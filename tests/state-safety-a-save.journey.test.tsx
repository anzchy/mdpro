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
    const expectedWrites = [
      { command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ];
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
    expect(journey.boundary.corpus.files.get(path)).toBe(expected);
    expect(journey.documentStore.getState().getDocumentById(id)).toMatchObject({ content: expected, savedContent: expected, isModified: false });
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    await journey.advance(250);
    expect(journey.boundary.calls.filter(call => call.command === 'save_file')).toHaveLength(1);
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
    expect(journey.documentStore.getState().getDocumentById(id)?.savedContent).toBe(expected);
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
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

it('a-C2 rejects stale bytes after two edits before the sync delay', async () => {
  const journey = await createAppJourney({ strictMode: true });
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    await journey.type('Y');
    await journey.menu('file.save');
    const expected = content.replace(/b\n$/, 'bXY\n');
    const expectedWrites = [
      { command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ];
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
    expect(journey.documentStore.getState().getDocumentById(id)).toMatchObject({ content: expected, savedContent: expected, isModified: false });
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    await journey.advance(250);
    expect(journey.boundary.calls.filter(call => call.command === 'save_file')).toHaveLength(1);
    expect(journey.boundary.writeLog).toEqual(expectedWrites);
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
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

it('a-C2 keyboard Cmd+S saves the latest pending edit', async () => {
  const journey = await createAppJourney({ strictMode: true });
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    await journey.shortcutSave();
    const expected = content.replace(/b\n$/, 'bX\n');
    expect(journey.boundary.writeLog).toEqual([
      { command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ]);
    expect(journey.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: expected, savedContent: expected, isModified: false });
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    await journey.advance(250);
    expect(journey.boundary.writeLog).toEqual([
      { command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ]);
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
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

it('a-C2 keyboard Cmd+S refuses a failed serializer', async () => {
  const journey = await createAppJourney({ strictMode: true });
  try {
    const { id, path, content } = await journey.openCase('a-neighbor-edit');
    await journey.type('X');
    journey.breakSerializer();
    const before = journey.readTokens(id);
    const toastStart = journey.toastHistory.length;
    const logStart = journey.boundary.logs.length;
    await journey.shortcutSave();
    expect(journey.boundary.calls.filter(call => ['save_file', 'save_file_dialog'].includes(call.command))).toEqual([]);
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.boundary.corpus.files.get(path)).toBe(content);
    expect(journey.documentStore.getState().getDocumentById(id)).toMatchObject({ id, savedContent: content, isModified: true });
    expect(journey.readTokens(id)).toEqual(before);
    expect(journey.toastHistory.slice(toastStart)).toEqual([expect.stringMatching(/^Save failed:/)]);
    expect(journey.boundary.logs.slice(logStart).filter(log => log.event === 'file.save')).toEqual([
      expect.objectContaining({ status: 'fail' }),
    ]);
    expect(journey.toastStore.getState().message).toMatch(/^Save failed:/);
    await journey.advance(250);
    expect(journey.boundary.writeLog).toEqual([]);
    expect(journey.readTokens(id)).toEqual(before);
    expect(journey.toastHistory.slice(toastStart)).toEqual([expect.stringMatching(/^Save failed:/)]);
    expect(journey.boundary.logs.slice(logStart).filter(log =>
      String(log.event).startsWith('file.save') && log.status === 'success')).toEqual([]);
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
