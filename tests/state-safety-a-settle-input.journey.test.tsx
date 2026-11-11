import { expect, it, vi } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C3 preserves input typed during a held save and settles the editor', async () => {
  const j = await createAppJourney();
  try {
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
    const first = content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content: first } }]);
    await j.type('亲爱的');
    release();
    await j.flushMicrotasks();
    const latest = content.replace(/b\n$/, 'bX亲爱的\n');
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: id, path, content: first, bytes: [...new TextEncoder().encode(first)],
    }]);
    expect(j.boundary.corpus.files.get(path)).toBe(first);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: latest, isModified: true });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    expect(j.boundary.calls.filter(c => c.command === 'delete_draft')).toEqual([]);
    expect(j.toastHistory).not.toContain('Save failed: editor changes could not be captured; the document was not saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);


it('a-C3 unchanged editor settles without inventing a dirty edit', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    await j.menu('file.save');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content } }]);
    expect(j.boundary.writeLog).toEqual([
      { command: 'save_file', documentId: id, path, content, bytes: [...new TextEncoder().encode(content)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content, savedContent: content, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    expect(j.toastHistory).not.toContain('Save failed: editor changes could not be captured; the document was not saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
