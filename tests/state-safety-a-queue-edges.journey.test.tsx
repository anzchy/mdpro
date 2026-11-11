import { expect, it, vi } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('a-C1 failed first save settles the queue and the second writes the latest bytes', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    const original = j.boundary.corpus.invoke.bind(j.boundary.corpus);
    let rejectFirst!: (error: Error) => void;
    const held = new Promise<never>((_, reject) => { rejectFirst = reject; });
    let count = 0;
    vi.spyOn(j.boundary.corpus, 'invoke').mockImplementation(async (command, args) => {
      if (command === 'save_file' && ++count === 1) return held;
      return original(command, args);
    });
    await j.type('X');
    await j.menu('file.save');
    await j.type('Y');
    await j.menu('file.save');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toHaveLength(1);
    rejectFirst(new Error('disk full'));
    await j.flushMicrotasks();
    const expected = content.replace(/b\n$/, 'bXY\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file')).toMatchObject([
      { args: { documentId: id, path, content: content.replace(/b\n$/, 'bX\n') } },
      { args: { documentId: id, path, content: expected } },
    ]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: id, path, content: expected, bytes: [...new TextEncoder().encode(expected)],
    }]);
    expect(j.boundary.corpus.files.get(path)).toBe(expected);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: expected, savedContent: expected, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
    expect(j.toastHistory.some(message => message?.startsWith('Save failed:'))).toBe(true);
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C1 queued save retains document A after B becomes active', async () => {
  const j = await createAppJourney();
  try {
    const a = await j.openCase('a-neighbor-edit');
    const aBefore = j.readTokens(a.id);
    const original = j.boundary.corpus.invoke.bind(j.boundary.corpus);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    vi.spyOn(j.boundary.corpus, 'invoke').mockImplementation(async (command, args) => {
      if (command === 'save_file' && first) { first = false; await held; }
      return original(command, args);
    });
    await j.type('X');
    await j.menu('file.save');
    await j.type('Y');
    await j.menu('file.save');
    const b = await j.openCase('a-one-blank');
    const bBefore = j.readTokens(b.id);
    const aWhileB = j.readTokens(a.id);
    release();
    await j.flushMicrotasks();
    const firstBytes = a.content.replace(/b\n$/, 'bX\n');
    const secondBytes = a.content.replace(/b\n$/, 'bXY\n');
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([firstBytes, secondBytes].map(text => ({
      command: 'save_file', documentId: a.id, path: a.path, content: text, bytes: [...new TextEncoder().encode(text)],
    })));
    expect(j.boundary.calls.filter(c => c.command === 'save_file').map(c => c.args.documentId)).toEqual([a.id, a.id]);
    expect(j.boundary.corpus.files.get(a.path)).toBe(secondBytes);
    expect(j.boundary.corpus.files.get(b.path)).toBe(b.content);
    expect(j.documentStore.getState().getDocumentById(b.id)).toMatchObject({ id: b.id, content: b.content, savedContent: b.content, isModified: false });
    expect(j.readTokens(b.id)).toEqual(bBefore);
    expect(j.readTokens(a.id)).toEqual({ ...aWhileB, lifetime: aBefore.lifetime + 2, replacement: aBefore.replacement + 2 });
    expect(j.documentStore.getState().getDocumentById(a.id)).toMatchObject({ id: a.id, content: secondBytes, savedContent: secondBytes, isModified: false });
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C1 a pending A save does not block a different document B', async () => {
  const j = await createAppJourney();
  try {
    const a = await j.openCase('a-neighbor-edit');
    const aBefore = j.readTokens(a.id);
    const original = j.boundary.corpus.invoke.bind(j.boundary.corpus);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let heldA = false;
    vi.spyOn(j.boundary.corpus, 'invoke').mockImplementation(async (command, args) => {
      if (command === 'save_file' && args?.documentId === a.id && !heldA) { heldA = true; await held; }
      return original(command, args);
    });
    await j.type('X');
    await j.menu('file.save');
    const b = await j.openCase('a-one-blank');
    const bBefore = j.readTokens(b.id);
    await j.type('Z');
    await j.menu('file.save');
    const bSaved = b.content.replace(/b\n$/, 'bZ\n');
    expect(j.boundary.calls.filter(c => c.command === 'save_file').map(c => c.args.documentId)).toEqual([a.id, b.id]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([{
      command: 'save_file', documentId: b.id, path: b.path, content: bSaved, bytes: [...new TextEncoder().encode(bSaved)],
    }]);
    expect(j.boundary.corpus.files.get(b.path)).toBe(bSaved);
    expect(j.boundary.corpus.files.get(a.path)).toBe(a.content);
    expect(j.documentStore.getState().getDocumentById(b.id)).toMatchObject({ id: b.id, content: bSaved, savedContent: bSaved, isModified: false });
    expect(j.readTokens(b.id)).toEqual({ ...bBefore, lifetime: bBefore.lifetime + 1, replacement: bBefore.replacement + 1 });
    const aWhileB = j.readTokens(a.id);
    release();
    await j.flushMicrotasks();
    const aSaved = a.content.replace(/b\n$/, 'bX\n');
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([
      { command: 'save_file', documentId: b.id, path: b.path, content: bSaved, bytes: [...new TextEncoder().encode(bSaved)] },
      { command: 'save_file', documentId: a.id, path: a.path, content: aSaved, bytes: [...new TextEncoder().encode(aSaved)] },
    ]);
    expect(j.boundary.corpus.files.get(a.path)).toBe(aSaved);
    expect(j.documentStore.getState().getDocumentById(a.id)).toMatchObject({ id: a.id, content: aSaved, savedContent: aSaved, isModified: false });
    expect(j.readTokens(a.id)).toEqual({ ...aWhileB, lifetime: aBefore.lifetime + 1, replacement: aBefore.replacement + 1 });
    expect(j.toastHistory).not.toContain('Save failed: editor changes could not be captured; the document was not saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C1 Save and Save As share one document queue', async () => {
  const j = await createAppJourney();
  try {
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    const original = j.boundary.corpus.invoke.bind(j.boundary.corpus);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let heldOnce = false;
    vi.spyOn(j.boundary.corpus, 'invoke').mockImplementation(async (command, args) => {
      if (command === 'save_file' && !heldOnce) { heldOnce = true; await held; }
      return original(command, args);
    });
    const target = '/tmp/mig002/queued-save-as.md';
    j.boundary.scriptDialog('save', target);
    await j.type('X');
    await j.menu('file.save');
    await j.type('Y');
    await j.menu('file.save_as');
    expect(j.boundary.calls.filter(c => c.command === 'save_file_dialog')).toEqual([]);
    release();
    await j.flushMicrotasks();
    const first = content.replace(/b\n$/, 'bX\n');
    const second = content.replace(/b\n$/, 'bXY\n');
    expect(j.boundary.calls.filter(c => ['save_file', 'save_file_dialog'].includes(c.command))).toMatchObject([
      { command: 'save_file', args: { documentId: id, path, content: first } },
      { command: 'save_file_dialog', args: { documentId: id, originalPath: path, content: second } },
    ]);
    expect(j.boundary.writeLog.filter(w => ['save_file', 'save_file_dialog'].includes(w.command))).toEqual([
      { command: 'save_file', documentId: id, path, content: first, bytes: [...new TextEncoder().encode(first)] },
      { command: 'save_file_dialog', documentId: id, path: target, content: second, bytes: [...new TextEncoder().encode(second)] },
    ]);
    expect(j.boundary.corpus.files.get(path)).toBe(first);
    expect(j.boundary.corpus.files.get(target)).toBe(second);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path: target, content: second, savedContent: second, isModified: false });
    expect(j.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 2, replacement: before.replacement + 2, baselineByPath: before.baselineByPath + 1 });
    expect(j.toastHistory).not.toContain('Save failed: editor changes could not be captured; the document was not saved');
  } finally {
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
