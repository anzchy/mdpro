import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';
import { openA2LCase } from './helpers/a2CorpusCase';
import { beginA2Composition } from './helpers/a2Composition';

it('a-C9 pins Cmd+S while CJK IME composition is active', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await openA2LCase(j, 'l-cjk-type');
    const before = j.readTokens(id);
    const composing = '亲爱的';
    const endComposition = await beginA2Composition(j, composing, 'p:last-child');
    await j.shortcutSave();
    const expected = '你好，世界。亲爱的\n';
    const write = { command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] };
    const draft = { command: 'delete_draft', documentId: id, content: '', bytes: [] };
    expect(j.boundary.writeLog).toEqual([write, draft]);
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content: expected } }]);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: expected, savedContent: expected, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    await endComposition();
    await j.advance(250);
    await j.shortcutSave();
    expect(j.boundary.writeLog).toEqual([write, draft, write, draft]);
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([
      { args: { documentId: id, path, content: expected } },
      { args: { documentId: id, path, content: expected } },
    ]);
    expect(j.boundary.corpus.files.get(path)).toBe(expected);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: expected, savedContent: expected, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 2, replacement: before.replacement + 2 });
    expect(j.toastHistory).not.toContain('Save failed: editor changes could not be captured; the document was not saved');
    expect(content).toBe('你好，世界。\n');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
