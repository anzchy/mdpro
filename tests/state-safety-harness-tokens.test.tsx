import { expect, it } from 'vitest';
import { createAppJourney } from './helpers/appJourneyHarness';

it('H9 readTokens reports the document lifetime and replacement deltas', async () => {
  const journey = await createAppJourney();
  try {
    const { id } = await journey.openCase('a-neighbor-edit');
    const before = journey.readTokens(id);
    await journey.type('X');
    await journey.menu('file.save');
    expect(journey.readTokens(id)).toEqual({ ...before, lifetime: before.lifetime + 1, replacement: before.replacement + 1 });
  } finally { journey.toastStore.getState().clearToast(); await journey.cleanup(); }
}, 15_000);

it('H10 records each notified document and editor state transition', async () => {
  const journey = await createAppJourney();
  try {
    const { id } = await journey.openCase('a-neighbor-edit');
    const first = journey.transitions.length;
    await journey.type('X');
    await journey.menu('file.save');
    const steps = journey.transitions.slice(first);
    expect(steps.some(step => step.source === 'document' && step.activeId === id && step.documents.some(doc => doc.id === id && doc.dirty))).toBe(true);
    expect(steps.at(-1)?.documents.find(doc => doc.id === id)?.dirty).toBe(false);
    const saved = journey.documentStore.getState().getDocumentById(id);
    expect(steps.at(-1)).toMatchObject({
      activeId: id,
      documents: [{ id, path: saved?.path, content: saved?.content, savedContent: saved?.savedContent, dirty: false }],
      lifetimeEpoch: journey.documentStore.getState().lifetimeEpoch,
      replacementEpoch: journey.documentStore.getState().replacementEpoch,
      baselineEpoch: journey.documentStore.getState().baselineEpoch,
      baselinePathEpoch: journey.documentStore.getState().baselinePathEpoch,
      flusherDocumentIds: [id],
      editorStatus: 'created',
    });
    const lastSaved = steps.at(-1);
    const generation = journey.milkdownStore.getState().editorGenerations[id] ?? 0;
    journey.milkdownStore.getState().reloadEditor(id, 'recorder-test');
    expect(journey.transitions.at(-1)).toMatchObject({ source: 'milkdown', editorGenerations: { [id]: generation + 1 } });
    expect(lastSaved).toMatchObject({ editorGenerations: { [id]: generation } });
  } finally { journey.toastStore.getState().clearToast(); await journey.cleanup(); }
}, 15_000);

it('H10 snapshots both stores at each notification without mutating earlier snapshots', async () => {
  const journey = await createAppJourney();
  try {
    const { id } = await journey.openCase('a-neighbor-edit');
    const initial = journey.transitions.at(-1);
    const current = journey.documentStore.getState().getDocumentById(id);
    if (!current) throw new Error('opened document absent');
    const path = '/tmp/mig002/changed.md';
    journey.documentStore.setState({
      documents: [{ ...current, path, content: 'edited', savedContent: 'baseline', isModified: true }],
      lifetimeEpoch: { [id]: 17 }, replacementEpoch: { [id]: 18 },
      baselineEpoch: { [id]: 19 }, baselinePathEpoch: { [path]: 20 },
    });
    const documentStep = journey.transitions.at(-1);
    expect(documentStep).toMatchObject({
      source: 'document', activeId: id,
      documents: [{ id, path, content: 'edited', savedContent: 'baseline', isModified: true }],
      lifetimeEpoch: { [id]: 17 }, replacementEpoch: { [id]: 18 },
      baselineEpoch: { [id]: 19 }, baselinePathEpoch: { [path]: 20 },
      flusherDocumentIds: [id], editorStatus: 'created',
    });
    const generationBefore = journey.milkdownStore.getState().editorGenerations[id] ?? 0;
    journey.milkdownStore.getState().reloadEditor(id, 'snapshot-test');
    expect(journey.transitions.at(-1)).toMatchObject({
      source: 'milkdown', activeId: id,
      documents: [{ id, path, content: 'edited', savedContent: 'baseline', isModified: true }],
      lifetimeEpoch: { [id]: 17 }, replacementEpoch: { [id]: 18 },
      baselineEpoch: { [id]: 19 }, baselinePathEpoch: { [path]: 20 },
      editorGenerations: { [id]: generationBefore + 1 },
    });
    expect(documentStep?.editorGenerations[id]).toBe(generationBefore || undefined);
    expect(initial?.documents[0]?.content).toBe(current.content);
  } finally { journey.toastStore.getState().clearToast(); await journey.cleanup(); }
}, 15_000);
