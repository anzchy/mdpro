import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { createAppJourney } from './appJourneyHarness';

type Journey = Awaited<ReturnType<typeof createAppJourney>>;
const cases = JSON.parse(readFileSync(resolve('tests/fixtures/markdown-corpus/l.json'), 'utf8')) as
  Array<{ caseId: string; input: string }>;

/** Open a category-l case through the real App event route, preserving its case id. */
export async function openA2LCase(j: Journey, caseId: string) {
  const entry = cases.find(item => item.caseId === caseId);
  if (!entry) throw new Error(`unknown category-l case: ${caseId}`);
  const content = readFileSync(resolve('tests/fixtures/markdown-corpus', entry.input), 'utf8');
  const path = `/tmp/mig002/${caseId}.md`;
  j.boundary.corpus.seed(path, content);
  j.boundary.emit('file:open', [path], true);
  await j.flushMicrotasks();
  for (let i = 0; i < 30 && (!j.documentStore.getState().activeDocumentId ||
    j.milkdownStore.getState().getEditor() === null); i += 1) await j.advance(10);
  const id = j.documentStore.getState().activeDocumentId;
  if (!id) throw new Error(`App did not open ${caseId}`);
  for (let i = 0; i < 30; i += 1) {
    try { j.editor(); break; } catch { await j.advance(10); }
  }
  j.editor();
  return { id, path, content };
}
