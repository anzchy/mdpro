/** Per-case scratch artifacts are snapshots, never paths to copy into the fixture tree. */
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CorpusRecord, LargeDocGuardDecision } from '../../tests/support/corpus/types.ts';
import type { ComparisonActual, ComparisonReport } from '../../tests/support/corpus/comparator.ts';
export type ScratchCaseResult = { caseId: string; caseKind: 'mounting'; actual: ComparisonActual; report: ComparisonReport }
  | { caseId: string; caseKind: 'guard-only'; actual: { observation: LargeDocGuardDecision }; report: ComparisonReport };
import { canonicalJson } from '../../tests/support/corpus/canonical.ts';
import { readTree } from './files.ts';
export function writeScratchResult(scratch: string, record: CorpusRecord, result: ScratchCaseResult): void {
  if (!/^[a-n]-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.caseId) || record.caseId !== result.caseId ||
      (record.caseKind ?? 'mounting') !== result.caseKind) throw new Error(`${record.caseId}: invalid scratch result identity`);
  const root = resolve(scratch);
  if (existsSync(root)) readTree(root); else mkdirSync(root, { recursive: true });
  const directory = join(root, 'results');
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('scratch results symlink is forbidden');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, record.caseId + '.json');
  writeFileSync(path, canonicalJson({ caseId: result.caseId, record, actual: result.actual, report: result.report }), { flag: 'wx' });
}
export function compareScratchTrees(left: string, right: string): void {
  const a = readTree(left), b = readTree(right);
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (!Object.hasOwn(a, path) || !Object.hasOwn(b, path)) throw new Error(`${path}: missing scratch file`);
    if (!a[path].equals(b[path])) throw new Error(`${path}: scratch bytes differ`);
  }
}
