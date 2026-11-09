import { expect, it } from 'vitest';
import { FakeTauriBoundary } from './support/corpus/fakeBoundary.ts';
const bytes = (text: string) => [...new TextEncoder().encode(text)];
it('opening seeded UTF-8 content reads exactly and writes nothing', async () => {
  const b = new FakeTauriBoundary();
  const content = '\n漢字 👩🏽‍💻 é\n\n';
  b.seed('/corpus/input.md', content);
  expect(await b.invoke('open_file', { path: '/corpus/input.md' })).toEqual({
    document: { id: 'corpus-document', path: '/corpus/input.md', content, encoding: 'UTF-8', lineEnding: 'lf',
      isModified: false, lastSaved: null, fileSize: bytes(content).length },
    recoveredDraft: null, changedSinceRead: false, holdGen: 0,
  });
  expect(b.writeLog).toEqual([]);
});
it('file save records exact bytes once and exposes an immutable request snapshot', async () => {
  const b = new FakeTauriBoundary();
  const content = '\nnew 漢字\n\n';
  const args = { documentId: 'doc-a', path: '/corpus/input.md', content };
  expect(await b.invoke('save_file', args)).toMatchObject({ success: true, path: args.path, savedAt: expect.any(Number) });
  args.content = 'later';
  expect(b.files.get(args.path)).toBe(content);
  expect(b.writeLog).toEqual([{ command: 'save_file', documentId: 'doc-a', path: args.path, content, bytes: bytes(content) }]);
});
it('draft save and delete retain the exact content affected by each operation', async () => {
  const b = new FakeTauriBoundary();
  const content = 'draft\n\n漢字';
  expect(await b.invoke('save_draft', { documentId: 'doc-a', content })).toEqual({ revision: '1', saveOrder: 1 });
  expect(b.drafts.get('doc-a')).toBe(content);
  await b.invoke('delete_draft', { documentId: 'doc-a' });
  expect(b.drafts.has('doc-a')).toBe(false);
  expect(b.writeLog).toEqual([
    { command: 'save_draft', documentId: 'doc-a', content, bytes: bytes(content) },
    { command: 'delete_draft', documentId: 'doc-a', content, bytes: bytes(content) },
  ]);
});
it('opener records a completed handoff once and reset isolates all state', async () => {
  const b = new FakeTauriBoundary();
  b.seed('/one.md', 'one');
  await b.invoke('save_draft', { documentId: 'one', content: 'draft' });
  b.events.push({ event: 'example' }); b.unresolvedAssets.add('/missing.png');
  await b.openUrl('https://example.com/exact?q=漢字');
  expect(b.openerCalls).toEqual(['https://example.com/exact?q=漢字']);
  expect(new FakeTauriBoundary().openerCalls).toEqual([]);
  b.reset();
  expect([b.files.size, b.drafts.size, b.unresolvedAssets.size]).toEqual([0, 0, 0]);
  expect([b.writeLog, b.events, b.openerCalls]).toEqual([[], [], []]);
});
it('asset conversion is deterministic and can model an unresolved native asset', () => {
  const b = new FakeTauriBoundary();
  expect(b.convertFileSrc('/corpus/漢字 a.png')).toBe('asset://localhost/%2Fcorpus%2F%E6%BC%A2%E5%AD%97%20a.png');
  b.unresolvedAssets.add('/missing.png');
  expect(() => b.convertFileSrc('/missing.png')).toThrow('unresolved asset');
});
it('unknown IPC and invalid writes fail without changing storage or logs', async () => {
  const b = new FakeTauriBoundary(); b.seed('/one.md', 'one');
  await expect(b.invoke('unexpected_command')).rejects.toThrow('unexpected_command');
  await expect(b.invoke('open_file', { path: '/missing.md' })).rejects.toThrow('/missing.md');
  for (const args of [{ documentId: 'x' }, { documentId: 'x', content: 42 }, { content: 'x' }]) {
    await expect(b.invoke('save_draft', args)).rejects.toThrow('save_draft');
  }
  expect([...b.files]).toEqual([['/one.md', 'one']]);
  expect(b.writeLog).toEqual([]);
});
it('multiple files have distinct stable document identities and independent writes', async () => {
  const b = new FakeTauriBoundary(); b.seed('/one.md', 'one'); b.seed('/two.md', 'two');
  const open = (path: string) => b.invoke('open_file', { path }) as Promise<{ document: { id: string; content: string } }>;
  const first = await open('/one.md'), second = await open('/two.md');
  expect(second.document.id).not.toBe(first.document.id);
  expect((await open('/one.md')).document).toEqual(first.document);
  await b.invoke('save_file', { documentId: first.document.id, path: '/one.md', content: 'edited one' });
  expect((await open('/two.md')).document.content).toBe('two');
  expect(b.writeLog).toHaveLength(1);
});
it('Save As selects a deterministic native path, records its real IPC command, and can cancel', async () => {
  const b = new FakeTauriBoundary();
  const content = '\nuntitled 漢字\n';
  const request = { documentId: 'untitled', content, suggestedName: 'Untitled', encoding: 'UTF-8', lineEnding: 'lf' };
  expect(await b.invoke('save_file_dialog', request)).toMatchObject({ success: true, path: '/corpus/saved.md' });
  expect(b.files.get('/corpus/saved.md')).toBe(content);
  expect(b.writeLog).toEqual([{ command: 'save_file_dialog', documentId: 'untitled', path: '/corpus/saved.md', content, bytes: bytes(content) }]);
  Object.assign(b, { saveDialogPath: null });
  expect(await b.invoke('save_file_dialog', { ...request, content: 'cancelled' })).toBeNull();
  expect(b.writeLog).toHaveLength(1);
  expect(b.files.get('/corpus/saved.md')).toBe(content);
});
