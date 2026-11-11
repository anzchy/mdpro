import { expect, it, vi } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C6 an external change after write start survives save-result application', async () => {
  const j = await createAppJourney();
  try {
    const { pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    const original = j.boundary.corpus.invoke.bind(j.boundary.corpus);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(j.boundary.corpus, 'invoke').mockImplementation(async (command, args) => {
      if (command === 'save_file') await held;
      return original(command, args);
    });
    await j.type('X');
    await j.menu('file.save');
    const written = content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content: written } }]);
    j.boundary.emit('file:changed', { path, changeType: 'modified', newPath: null, timestamp: Date.now() });
    await j.advance(350);
    const pending = pendingFileChangeFor(id);
    expect(pending).toBeDefined();
    release();
    await j.flushMicrotasks();
    expect(pendingFileChangeFor(id)).toEqual(pending);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: id, path, content: written, bytes: [...new TextEncoder().encode(written)],
    }]);
    expect(j.boundary.corpus.files.get(path)).toBe(written);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: written, savedContent: undefined, isModified: true });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1,
      baselineById: before.baselineById + 1, baselineByPath: before.baselineByPath + 1 });
    await j.menu('file.save');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toHaveLength(1);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toHaveLength(1);
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
