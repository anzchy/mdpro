import { expect, it, vi } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

async function holdSaveReply(j: Awaited<ReturnType<typeof createAppJourney>>) {
  const invoke = j.boundary.corpus.invoke.bind(j.boundary.corpus);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let sawWrite = false;
  vi.spyOn(j.boundary.corpus, 'invoke').mockImplementation(async (command, args) => {
    const result = await invoke(command, args);
    if (command === 'save_file' && !sawWrite) {
      sawWrite = true;
      await held;
    }
    return result;
  });
  return { release, sawWrite: () => sawWrite };
}

it('a-KL2 pins a stale save result rebaselining a replacement after write start', async () => {
  const j = await createAppJourney({ strictMode: true });
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const held = await holdSaveReply(j);
    await j.type('X');
    await j.menu('file.save');
    expect(held.sawWrite()).toBe(true);
    const written = content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content: written } }]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: id, path, content: written, bytes: [...new TextEncoder().encode(written)],
    }]);
    const current = j.documentStore.getState().getDocumentById(id)!;
    const replacement = content.replace(/b\n$/, 'bNEW\n');
    j.documentStore.getState().upsertDocument({ ...current, content: replacement, savedContent: content, isModified: true });
    const afterReplace = j.readTokens(id);
    held.release();
    await j.flushMicrotasks();
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path, content: replacement, isModified: true });
    expect(j.documentStore.getState().getDocumentById(id)?.savedContent).toBe(written);
    expect(j.readTokens(id)).not.toEqual(afterReplace);
    expect(j.boundary.corpus.files.get(path)).toBe(written);
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C5 StrictMode close/reopen after the write starts cannot clean the reopened buffer', async () => {
  const j = await createAppJourney({ strictMode: true });
  try {
    const opened = await j.openCase('a-neighbor-edit');
    const held = await holdSaveReply(j);
    await j.type('X');
    await j.menu('file.save');
    expect(held.sawWrite()).toBe(true);
    const written = opened.content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: opened.id, path: opened.path, content: written } }]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: opened.id, path: opened.path, content: written, bytes: [...new TextEncoder().encode(written)],
    }]);
    j.documentStore.getState().closeDocument(opened.id);
    const reopened = await j.openCase('a-neighbor-edit');
    expect(reopened.id).toBe(opened.id);
    await j.type('NEW');
    await j.advance(100);
    const newer = opened.content.replace(/b\n$/, 'bNEW\n');
    const tokens = j.readTokens(reopened.id);
    held.release();
    await j.flushMicrotasks();
    expect(j.documentStore.getState().getDocumentById(reopened.id)).toMatchObject({
      id: reopened.id, path: reopened.path, content: newer, isModified: true,
    });
    expect(j.documentStore.getState().getDocumentById(reopened.id)?.savedContent).not.toBe(written);
    expect(j.readTokens(reopened.id)).toEqual({ ...tokens, lifetime: tokens.lifetime + 1, replacement: tokens.replacement + 1 });
    expect(j.boundary.corpus.files.get(opened.path)).toBe(opened.content);
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-KL2 pins a stale save result restoring the old path after write start', async () => {
  const j = await createAppJourney({ strictMode: true });
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const held = await holdSaveReply(j);
    await j.type('X');
    await j.menu('file.save');
    expect(held.sawWrite()).toBe(true);
    const written = content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([{ args: { documentId: id, path, content: written } }]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: id, path, content: written, bytes: [...new TextEncoder().encode(written)],
    }]);
    const moved = '/tmp/mig002/moved-after-write.md';
    j.documentStore.getState().updateDocumentPath(id, moved);
    const beforeReply = j.documentStore.getState().getDocumentById(id)!;
    const tokens = j.readTokens(id);
    held.release();
    await j.flushMicrotasks();
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({
      id, path, content: beforeReply.content, savedContent: written, isModified: false,
    });
    expect(j.readTokens(id)).not.toEqual(tokens);
    expect(j.boundary.corpus.files.get(path)).toBe(written);
    expect(j.boundary.corpus.files.has(moved)).toBe(false);
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
