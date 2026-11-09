/** Node-only read-only corpus loading and executable metadata checks. No engine or runner imports. */
import { resolve } from 'node:path';
import type { CorpusRecord } from '../../tests/support/corpus/types.ts';
import { canonicalJson } from '../../tests/support/corpus/canonical.ts';
import { validateManifest } from '../../tests/support/corpus/metadata.ts';
import { compareCase } from '../../tests/support/corpus/comparator.ts';
import { readTree } from './files.ts';
import { defaultFixtureRoot, verifyBaseline as gitVerify } from './provenance.ts';
export interface CorpusData { root: string; records: CorpusRecord[]; files: Record<string, string>; shards: Record<string, CorpusRecord[]> }
export interface CheckOptions { verifyBaseline?: (sha: string) => void }
export function loadCorpus(root = defaultFixtureRoot): CorpusData {
  const data: CorpusData = { root: resolve(root), records: [], files: {}, shards: {} };
  for (const [path, bytes] of Object.entries(readTree(data.root))) {
    const source = bytes.toString('utf8');
    if (/^[a-n]\.json$/.test(path)) {
      let records: unknown;
      try { records = JSON.parse(source); } catch { throw new Error(`${path}: manifest must contain JSON`); }
      if (!Array.isArray(records)) throw new Error(`${path}: manifest must be an array`);
      if (source !== canonicalJson(records)) throw new Error(`${path}: canonical key order and formatting required`);
      for (const record of records) if (record?.category !== path[0]) throw new Error(`${record?.caseId ?? path}: category must match shard`);
      data.shards[path] = records as CorpusRecord[]; data.records.push(...records);
    } else data.files[path] = source;
  }
  if (!data.records.length) throw new Error('corpus is empty: no cases');
  return data;
}
export function checkData(data: CorpusData, options: CheckOptions = {}): string[] {
  const errors = validateManifest(data.records, { files: data.files });
  const checked = new Set<string>();
  for (const record of data.records) {
    try {
      if (!checked.has(record.baselineSha)) { (options.verifyBaseline ?? gitVerify)(record.baselineSha); checked.add(record.baselineSha); }
      if (record.caseKind === 'guard-only' || errors.some(error => error.startsWith(record.caseId + ':'))) continue;
      const observation = record.expected.observation ? JSON.parse(data.files[record.expected.observation]) : undefined;
      if (observation?.pasteSafety?.forbiddenFound?.length) throw new Error('pasteSafety found forbidden content');
      compareCase(record, { input: data.files[record.input], expectedSerialized: data.files[record.expected.serialized],
        ...(record.desired ? { desired: data.files[record.desired] } : {}), ...(observation ? { expectedObservation: observation } : {}) },
      { untouched: data.files[record.input], serialized: data.files[record.expected.serialized], ...(observation ? { observation } : {}) });
    } catch (error) { errors.push(`${record.caseId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return errors;
}
export function checkCorpus(root = defaultFixtureRoot, options: CheckOptions = {}): string[] {
  try { return checkData(loadCorpus(root), options); } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}
