import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C6 external change recorded before save IPC prevents a write', async () => {
  const j = await createAppJourney();
  let clearPending: (() => void) | undefined;
  try {
    const { acknowledgeFileChange, pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    clearPending = () => { const slot = pendingFileChangeFor(id); if (slot) acknowledgeFileChange(id, slot.seq, 'ignored'); };
    const before = j.readTokens(id);
    await j.type('X');
    const event = { path, changeType: 'modified', newPath: null, timestamp: Date.now() };
    j.boundary.emit('file:changed', event);
    await j.flushMicrotasks();
    expect(pendingFileChangeFor(id)?.event).toMatchObject(event);
    const callStart = j.boundary.calls.length;
    await j.menu('file.save');
    expect(j.boundary.calls.slice(callStart).map(c => c.command)).toContain('get_preferences');
    await j.advance(350);

    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, isModified: true, savedContent: undefined });
    expect(j.readTokens(id)).toEqual({ ...before, baselineById: before.baselineById + 1, baselineByPath: before.baselineByPath + 1 });
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    clearPending?.();
    await j.flushMicrotasks();
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C6 ignored deletion requires matching consent before recreating the old path', async () => {
  const j = await createAppJourney();
  try {
    const { ignoredDeletionFor, pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    await j.type('X');
    j.boundary.corpus.files.delete(path);
    j.boundary.emit('file:changed', { path, changeType: 'deleted', newPath: null, timestamp: Date.now() });
    await j.advance(350);
    expect(pendingFileChangeFor(id)).toBeDefined();
    await act(async () => { (j.view.getByRole('button', { name: 'Ignore' }) as HTMLButtonElement).click(); });
    await j.flushMicrotasks();
    const marker = ignoredDeletionFor(id);
    expect(marker).toMatchObject({ path });
    expect(pendingFileChangeFor(id)).toBeUndefined();
    await j.menu('file.save');
    expect(j.view.getByRole('dialog', { name: 'Recreate file' })).toBeTruthy();
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.has(path)).toBe(false);
    await act(async () => { (j.view.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).click(); });
    await j.flushMicrotasks();
    expect(ignoredDeletionFor(id)).toEqual(marker);
    await j.menu('file.save');
    await act(async () => { (j.view.getByRole('button', { name: 'Save to original path' }) as HTMLButtonElement).click(); });
    await j.flushMicrotasks();
    const expected = content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content: expected } }]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)],
    }]);
    expect(j.boundary.corpus.files.get(path)).toBe(expected);
    expect(ignoredDeletionFor(id)).toBeUndefined();
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: expected, savedContent: expected, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1,
      baselineById: before.baselineById + 1, baselineByPath: before.baselineByPath + 1 });
    expect(j.toastHistory).toContain('Saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C6 external change arriving during preferences read blocks the later write', async () => {
  const j = await createAppJourney();
  try {
    const { pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    const original = j.boundary.invoke.bind(j.boundary);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let heldOnce = false;
    vi.spyOn(j.boundary, 'invoke').mockImplementation(async (command, args) => {
      if (command === 'get_preferences' && !heldOnce) { heldOnce = true; await held; }
      return original(command, args);
    });
    await j.type('X');
    await j.menu('file.save');
    expect(heldOnce).toBe(true);
    j.boundary.emit('file:changed', { path, changeType: 'modified', newPath: null, timestamp: Date.now() });
    await j.advance(350);
    expect(pendingFileChangeFor(id)).toBeDefined();
    release();
    await j.flushMicrotasks();
    expect(j.boundary.calls.filter(c => c.command === 'get_preferences').length).toBeGreaterThan(1);
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, isModified: true, savedContent: undefined });
    expect(j.readTokens(id)).toEqual({ ...before, baselineById: before.baselineById + 1, baselineByPath: before.baselineByPath + 1 });
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    const { acknowledgeFileChange, pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const id = j.documentStore.getState().activeDocumentId;
    const slot = id ? pendingFileChangeFor(id) : undefined;
    if (id && slot) acknowledgeFileChange(id, slot.seq, 'ignored');
    await j.flushMicrotasks();
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
