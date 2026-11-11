import { expect, it, vi } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C5 StrictMode replacement during held Save invalidates the old task', async () => {
  const j = await createAppJourney({ strictMode: true });
  try {
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
    const current = j.documentStore.getState().getDocumentById(id)!;
    const replacement = content.replace(/b\n$/, 'bNEW\n');
    j.documentStore.getState().upsertDocument({ ...current, content: replacement, savedContent: content, isModified: true });
    const afterReplace = j.readTokens(id);
    expect(afterReplace.replacement).toBe(before.replacement + 1);
    release();
    await j.flushMicrotasks();
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path, content: replacement, savedContent: content, isModified: true });
    expect(j.readTokens(id)).toEqual(afterReplace);
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C5 StrictMode path move during held Save prevents the old-path write', async () => {
  const j = await createAppJourney({ strictMode: true });
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
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
    const moved = '/tmp/mig002/moved.md';
    j.documentStore.getState().updateDocumentPath(id, moved);
    const afterMove = j.readTokens(id);
    release();
    await j.flushMicrotasks();
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.boundary.corpus.files.has(moved)).toBe(false);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path: moved, isModified: true, savedContent: content });
    expect(j.readTokens(id)).toEqual(afterMove);
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C5 StrictMode close and reopen of the same id leaves the reopened buffer untouched', async () => {
  const j = await createAppJourney({ strictMode: true });
  try {
    const originalCase = await j.openCase('a-neighbor-edit');
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
    j.documentStore.getState().closeDocument(originalCase.id);
    const reopened = await j.openCase('a-neighbor-edit');
    expect(reopened.id).toBe(originalCase.id);
    await j.type('NEW');
    const afterReopen = j.readTokens(reopened.id);
    release();
    await j.flushMicrotasks();
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.get(reopened.path)).toBe(originalCase.content);
    expect(j.documentStore.getState().getDocumentById(reopened.id)).toMatchObject({ id: reopened.id, path: reopened.path, isModified: true, savedContent: originalCase.content });
    expect(j.readTokens(reopened.id)).toEqual(afterReopen);
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
