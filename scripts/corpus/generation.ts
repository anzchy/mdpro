/** Local generation validates all declared inputs before children and all outputs before its single merge. */
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ObservationKind } from '../../tests/support/corpus/types.ts';
import { OBSERVATION_KINDS } from '../../tests/support/corpus/vocabulary.ts';
import { validateManifest } from '../../tests/support/corpus/metadata.ts';
import { loadCorpus } from './core.ts';
import { readTree, safeLocation } from './files.ts';
import { mergeScratch, planMerge } from './merge.ts';
import { mergeBase as gitMergeBase, verifyBaseline as gitVerify } from './provenance.ts';
import { runRunners as defaultRunners } from './process.ts';
export interface GenerationOptions { root?: string; scratch?: string; caseIds?: readonly string[]; observations?: Readonly<Record<string, readonly ObservationKind[]>>; bootstrapSerialized?: readonly string[]; env?: Readonly<Record<string, string | undefined>>; merge?: boolean }
export interface RunnerRequest { root: string; scratch: string; caseIds: string[]; observations: Readonly<Record<string, readonly ObservationKind[]>>; bootstrapSerialized: readonly string[]; env: Record<string, string | undefined> }
export interface GenerationDependencies { runRunners?: (request: RunnerRequest) => Promise<void>; mergeBase?: () => string; verifyBaseline?: (sha: string) => void }
export async function generateCorpus(options: GenerationOptions = {}, dependencies: GenerationDependencies = {}): Promise<{ scratch: string; changed: string[] }> {
  const env = options.env ?? process.env;
  if (Object.hasOwn(env, 'CI')) throw new Error('corpus generation refused while CI is set');
  if (env.CORPUS_ENGINE && env.CORPUS_ENGINE !== 'milkdown') throw new Error('baseline generation requires milkdown engine');
  const data = loadCorpus(options.root), active = data.records.filter(record => record.status === 'active');
  const caseIds = [...(options.caseIds ?? active.map(record => record.caseId))].sort();
  if (!caseIds.length || new Set(caseIds).size !== caseIds.length || caseIds.some(id => !active.some(record => record.caseId === id))) throw new Error('invalid case selection');
  const observations = options.observations ?? {};
  const bootstrapSerialized = [...(options.bootstrapSerialized ?? [])];
  if (new Set(bootstrapSerialized).size !== bootstrapSerialized.length || bootstrapSerialized.some(id => !caseIds.includes(id))) throw new Error('invalid serialized bootstrap selection');
  for (const [id, kinds] of Object.entries(observations)) {
    if (!caseIds.includes(id) || !Array.isArray(kinds) || !kinds.length || new Set(kinds).size !== kinds.length || kinds.some(kind => !(OBSERVATION_KINDS as readonly unknown[]).includes(kind))) throw new Error(`${id}: invalid observation selection`);
  }
  const missingGenerated = new Set<string>();
  for (const record of data.records) if (record.caseKind !== 'guard-only' && caseIds.includes(record.caseId)) {
    if (record.expected?.serialized && !Object.hasOwn(data.files, record.expected.serialized) && !bootstrapSerialized.includes(record.caseId)) throw new Error(`${record.caseId}: missing expected serialized`);
    for (const path of [record.expected?.serialized, record.expected?.observation]) if (typeof path === 'string' && !Object.hasOwn(data.files, path)) missingGenerated.add(path);
    if (record.expected?.observation && missingGenerated.has(record.expected.observation) && !observations[record.caseId]?.length) throw new Error(`${record.caseId}: missing expected observation needs observation selection`);
  }
  const errors = validateManifest(data.records, { files: data.files }).filter(error => ![...missingGenerated].some(path => error.endsWith(' missing file ' + path)));
  if (errors.length) throw new Error(errors.join('\n'));
  const verify = dependencies.verifyBaseline ?? gitVerify;
  for (const sha of new Set(data.records.map(record => record.baselineSha))) verify(sha);
  const sha = (dependencies.mergeBase ?? gitMergeBase)(); verify(sha);
  const scratch = options.scratch ? resolve(options.scratch) : mkdtempSync(join(tmpdir(), 'mdpro-corpus-'));
  const inside = relative(safeLocation(data.root), safeLocation(scratch));
  if (!(inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside))) throw new Error('scratch must be outside fixture root');
  if (existsSync(scratch)) { if (Object.keys(readTree(scratch)).length) throw new Error('scratch output must start empty'); }
  else mkdirSync(scratch, { recursive: true });
  const request: RunnerRequest = { root: data.root, scratch, caseIds, observations, bootstrapSerialized, env: { ...env,
    CORPUS_ROOT: data.root, CORPUS_WRITE: '1', CORPUS_SCRATCH: scratch, CORPUS_CASE_IDS: JSON.stringify(caseIds), CORPUS_OBSERVATIONS: JSON.stringify(observations), CORPUS_BOOTSTRAP_SERIALIZED: JSON.stringify(bootstrapSerialized) } };
  await (dependencies.runRunners ?? defaultRunners)(request);
  const mergeOptions = { mergeBaseSha: sha, caseIds, verifyBaseline: verify };
  const changed = options.merge === false ? planMerge(data.root, scratch, mergeOptions).changed : mergeScratch(data.root, scratch, mergeOptions);
  return { scratch, changed };
}
