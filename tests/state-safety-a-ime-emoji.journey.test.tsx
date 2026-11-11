import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';
import { openA2LCase } from './helpers/a2CorpusCase';
import { beginA2Composition } from './helpers/a2Composition';

it('a-C9 preserves an emoji composition in a category-l heading', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await openA2LCase(j, 'l-heading-emoji-only');
    const before = j.readTokens(id);
    const composing = '🎊';
    await beginA2Composition(j, composing, 'h1:last-child');
    await j.shortcutSave();
    const expected = content.replace(/架构\n$/, '架构🎊\n');
    expect(j.boundary.writeLog).toEqual([
      { command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)] },
      { command: 'delete_draft', documentId: id, content: '', bytes: [] },
    ]);
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content: expected } }]);
    expect(j.boundary.corpus.files.get(path)).toBe(expected);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: expected, savedContent: expected, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    expect(expected).not.toContain('�');
    expect(j.toastHistory).not.toContain('Save failed: editor changes could not be captured; the document was not saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
