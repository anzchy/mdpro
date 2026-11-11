import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

const notice = JSON.parse(readFileSync(resolve('tests/fixtures/state-safety/save-notice.json'), 'utf8')) as {
  path: string; changeType: string; newPath: null; timestamp: number;
  origin: { windowLabel: string; documentId: string };
};

it('a-C8 labelled other-window notice keeps the dirty buffer and records the external change', async () => {
  const j = await createAppJourney();
  try {
    const { pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    const before = j.readTokens(id);
    expect(path).toBe(notice.path);
    expect(id).toBe(notice.origin.documentId);
    await j.type('X');
    const dirty = content.replace(/b\n$/, 'bX\n');
    j.boundary.fakeBehaviours.push({ behaviour: 'Save notice carries the Rust wire payload and saver origin',
      rustProof: 'src-tauri/src/services/file_watcher_save_notice_shape_tests.rs::mig002_a_c8_r1_shared_notice_fixture_matches_rust_wire_shape',
      fixture: 'tests/fixtures/state-safety/save-notice.json' });
    j.boundary.fakeBehaviours.push({ behaviour: 'Rust broadcasts to all windows; a targeted event for other does not reach main',
      rustProof: 'src-tauri/src/services/file_watcher_save_notice_shape_tests.rs::d173_wi2_s4_production_sink_emits_file_changed_and_reports_the_result' });
    j.boundary.emitTo('other', 'file:changed', notice);
    expect(pendingFileChangeFor(id)).toBeUndefined();
    j.boundary.emit('file:changed', notice);
    await j.advance(350);
    expect(pendingFileChangeFor(id)?.event).toMatchObject(notice);
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, path, content: dirty, savedContent: undefined, isModified: true });
    expect(j.readTokens(id)).toEqual({ ...before, baselineById: before.baselineById + 1, baselineByPath: before.baselineByPath + 1 });
    expect(j.boundary.calls.filter(c => ['save_file', 'reload_file'].includes(c.command))).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    const { acknowledgeFileChange, pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const id = j.documentStore.getState().activeDocumentId;
    const slot = id ? pendingFileChangeFor(id) : undefined;
    if (id && slot) acknowledgeFileChange(id, slot.seq, 'ignored');
    await j.flushMicrotasks();
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);

it('a-C8 own-save notice skips its document and leaves an earlier external record intact', async () => {
  const j = await createAppJourney();
  try {
    const { pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const { id, path, content } = await j.openCase('a-neighbor-edit');
    await j.type('X');
    const before = j.readTokens(id);
    const external = { path, changeType: 'modified', newPath: null, timestamp: notice.timestamp - 1 };
    j.boundary.emit('file:changed', external);
    await j.advance(350);
    const pending = pendingFileChangeFor(id);
    const afterExternal = j.readTokens(id);
    expect(pending).toBeDefined();
    j.boundary.emit('file:changed', { ...notice, origin: { windowLabel: 'main', documentId: id } });
    await j.flushMicrotasks();
    expect(pendingFileChangeFor(id)).toEqual(pending);
    expect(j.readTokens(id)).toEqual(afterExternal);
    expect(afterExternal).toEqual({ ...before, baselineById: before.baselineById + 1, baselineByPath: before.baselineByPath + 1 });
    expect(j.documentStore.getState().getDocumentById(id)).toMatchObject({ id, content: content.replace(/b\n$/, 'bX\n'), savedContent: undefined, isModified: true });
    expect(j.boundary.calls.filter(c => ['save_file', 'reload_file'].includes(c.command))).toEqual([]);
    expect(j.boundary.writeLog.filter(w => w.command === 'save_file')).toEqual([]);
    expect(j.boundary.corpus.files.get(path)).toBe(content);
    expect(j.boundary.logs.filter(l => l.event === 'file.change.received').at(-1)?.context).toMatchObject({ outcome: 'own-save' });
    expect(j.toastHistory).not.toContain('Saved');
  } finally {
    const { acknowledgeFileChange, pendingFileChangeFor } = await import('../src/stores/externalChangeStore');
    const id = j.documentStore.getState().activeDocumentId;
    const slot = id ? pendingFileChangeFor(id) : undefined;
    if (id && slot) acknowledgeFileChange(id, slot.seq, 'ignored');
    await j.flushMicrotasks();
    await j.advance(3_000);
    await j.cleanup();
  }
}, 15_000);
