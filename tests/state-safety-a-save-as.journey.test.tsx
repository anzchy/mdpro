import { act } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C7 Save As moves a document and the next save follows the chosen path', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    const target = '/tmp/mig002/saved-as.md';
    j.boundary.scriptDialog('save', target);
    await j.type('X');
    await j.menu('file.save_as');
    const first = content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file_dialog')).toMatchObject([{ args: { documentId: id, content: first, originalPath: path } }]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file_dialog')).toEqual([{
      command: 'save_file_dialog', documentId: id, path: target, content: first, bytes: [...new TextEncoder().encode(first)],
    }]);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path: target, content: first, savedContent: first, isModified: false });
    await j.type('Y');
    await j.menu('file.save');
    const second = content.replace(/b\n$/, 'bXY\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path: target, content: second } }]);
    expect(j.boundary.writeLog.filter(w => ['save_file', 'save_file_dialog'].includes(w.command))).toEqual([
      { command: 'save_file_dialog', documentId: id, path: target, content: first, bytes: [...new TextEncoder().encode(first)] },
      { command: 'save_file', documentId: id, path: target, content: second, bytes: [...new TextEncoder().encode(second)] },
    ]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.boundary.corpus.files.get(target)).toBe(second);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path: target, content: second, savedContent: second, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 2, replacement: before.replacement + 2, baselineByPath: before.baselineByPath + 1 });
    expect(j.toastHistory).not.toContain('Save failed: editor changes could not be captured; the document was not saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C7 Save As onto a second open tab currently refuses the target without overwriting it', async () => {
  const j = await createAppJourney();
  try {
    const a = await j.openCase('a-neighbor-edit');
    const b = await j.openCase('a-one-blank');
    j.documentStore.getState().setActiveDocumentId(a.id);
    await j.advance(50);
    await j.type('X');
    const aBefore = j.readTokens(a.id);
    const bBefore = j.readTokens(b.id);
    j.boundary.scriptDialog('save', b.path);
    await j.menu('file.save_as');
    expect(j.boundary.calls.filter(c => c.command === 'save_file_dialog')).toMatchObject([{ args: {
      documentId: a.id, originalPath: a.path, content: a.content.replace(/b\n$/, 'bX\n'),
    } }]);
    expect(j.boundary.writeLog.filter(w => ['save_file', 'save_file_dialog'].includes(w.command))).toEqual([]);
    expect(j.boundary.corpus.files.get(a.path)).toBe(a.content);
    expect(j.boundary.corpus.files.get(b.path)).toBe(b.content);
    expect(j.documentStore.getState().getDocumentById(a.id)).toMatchObject({ id: a.id, path: a.path, isModified: true, savedContent: a.content });
    expect(j.documentStore.getState().getDocumentById(b.id)).toMatchObject({ id: b.id, path: b.path, content: b.content, savedContent: b.content, isModified: false });
    expect(j.readTokens(a.id)).toEqual(aBefore);
    expect(j.readTokens(b.id)).toEqual(bBefore);
    expect(j.toastHistory.some(message => message?.includes('already open'))).toBe(true);
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C7 canceled Save As picker keeps the dirty path and bytes', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    await j.type('X');
    const before = j.readTokens(id);
    j.boundary.scriptDialog('save', null);
    await j.menu('file.save_as');
    expect(j.boundary.calls.filter(c => c.command === 'save_file_dialog')).toMatchObject([{ args: {
      documentId: id, originalPath: path, content: content.replace(/b\n$/, 'bX\n'),
    } }]);
    expect(j.boundary.writeLog.filter(w => ['save_file', 'save_file_dialog'].includes(w.command))).toEqual([]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path, isModified: true, savedContent: content });
    expect(j.readTokens(id)).toEqual(before);
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C7 canceled Save As after ignored deletion retains the same consent marker', async () => {
  const j = await createAppJourney();
  try {
    const { ignoredDeletionFor } = await import('../src/stores/externalChangeStore');
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    await j.type('X');
    const before = j.readTokens(id);
    j.boundary.corpus.files.delete(path);
    j.boundary.emit('file:changed', { path, changeType: 'deleted', newPath: null, timestamp: Date.now() });
    await j.advance(350);
    await act(async () => { (j.view.getByRole('button', { name: 'Ignore' }) as HTMLButtonElement).click(); });
    await j.flushMicrotasks();
    const marker = ignoredDeletionFor(id);
    expect(marker).toMatchObject({ path });
    j.boundary.scriptDialog('save', null);
    await j.menu('file.save_as');
    expect(j.boundary.calls.filter(c => c.command === 'save_file_dialog')).toMatchObject([{ args: {
      documentId: id, originalPath: path, content: content.replace(/b\n$/, 'bX\n'),
    } }]);
    expect(j.boundary.writeLog.filter(w => ['save_file', 'save_file_dialog'].includes(w.command))).toEqual([]);
    expect(j.boundary.corpus.files.has(path)).toBe(false);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path, isModified: true, savedContent: undefined });
    expect(j.readTokens(id)).toEqual({ ...before, baselineById: before.baselineById + 1,
      baselineByPath: before.baselineByPath + 1 });
    expect(ignoredDeletionFor(id)).toEqual(marker);
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
