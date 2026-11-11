import { expect, it, vi } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C3 a-KL1: settle-flush serializer throw currently reports Saved despite dirty editor', async () => {
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
    j.breakSerializer();
    release();
    await j.flushMicrotasks();
    const first = content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: id, path, content: first, bytes: [...new TextEncoder().encode(first)],
    }]);
    expect(j.boundary.corpus.files.get(path)).toBe(first);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, isModified: true });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    expect(j.toastHistory).toContain('Saved');
    expect(j.boundary.logs.filter(l => l.event === 'file.save' && l.status === 'success')).toMatchObject([{ context: { documentId: id, editedDuringSave: true } }]);
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
