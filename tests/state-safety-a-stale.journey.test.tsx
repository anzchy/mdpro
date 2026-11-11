import { act } from '@testing-library/react';
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
    const replacement = content.replace(/b\n$/, 'bNEW\n');
    j.boundary.corpus.seed(path, replacement);
    j.boundary.emit('file:changed', { path, changeType: 'modified', timestamp: Date.now() });
    await j.advance(350);
    await act(async () => { j.view.getByRole('button', { name: 'Reload' }).click(); });
    await j.flushMicrotasks();
    const afterReplace = j.readTokens(id);
    expect(afterReplace.replacement).toBe(before.replacement + 1);
    release();
    await j.flushMicrotasks();
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.get(path)).toBe(replacement);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path, content: replacement, isModified: false });
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
    j.boundary.emit('file:changed', { path, changeType: 'renamed', newPath: moved, timestamp: Date.now() });
    await j.advance(350);
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
