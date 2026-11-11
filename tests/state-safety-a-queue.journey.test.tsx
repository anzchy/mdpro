import { expect, it, vi } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C1 serializes two saves of one document through result application', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    const original = j.boundary.corpus.invoke.bind(j.boundary.corpus);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let saves = 0;
    vi.spyOn(j.boundary.corpus, 'invoke').mockImplementation(async (command, args) => {
      if (command === 'save_file' && ++saves === 1) await held;
      return original(command, args);
    });
    await j.type('X');
    await j.menu('file.save');
    const first = content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content: first } }]);
    await j.type('Y');
    await j.menu('file.save');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toHaveLength(1);
    expect(j.boundary.writeLog).toEqual([]);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, isModified: true, savedContent: content });
    release();
    await j.flushMicrotasks();
    const second = content.replace(/b\n$/, 'bXY\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([
      { args: { documentId: id, path, content: first } },
      { args: { documentId: id, path, content: second } },
    ]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([first, second].map(text => ({
      command: 'save_file', documentId: id, path, content: text, bytes: [...new TextEncoder().encode(text)],
    })));
    expect(j.boundary.corpus.files.get(path)).toBe(second);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: second, savedContent: second, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 2, replacement: before.replacement + 2 });
    expect(j.toastHistory).not.toContain('Save failed: editor changes could not be captured; the document was not saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
