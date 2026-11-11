import { act } from '@testing-library/react';
import { editorViewCtx } from '@milkdown/kit/core';
import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';
import { openA2LCase } from './helpers/a2CorpusCase';

it('a-C9 preserves an emoji composition in a category-l heading', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await openA2LCase(j, 'l-heading-emoji-only');
    const before = j.readTokens(id);
    const view = j.editor().action(ctx => ctx.get(editorViewCtx));
    const element = view.dom;
    const composing = '🎊';
    await act(async () => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: composing }));
      element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertCompositionText', data: composing, isComposing: true }));
      element.querySelector('h1:last-child')?.append(composing);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: composing, isComposing: true }));
    });
    expect(view.composing).toBe(true);
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
