// @vitest-environment node
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { canonicalJson } from '../support/corpus/canonical.ts';
import type { CorpusRecord, MountingRecord } from '../support/corpus/types.ts';
import { writeScratchResult, compareScratchTrees } from '../../scripts/corpus/scratch.ts';
import { mergeScratch } from '../../scripts/corpus/merge.ts';
import { generateCorpus } from '../../scripts/corpus/generation.ts';
const CHILD_TIMEOUT_MS = 2_000;
// execFile completes after the child closes; its bounded timeout kills and drains this owned Node child.
function nodeCli(args: string[], env = process.env): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(complete => {
    execFile(process.execPath, args, { encoding: 'utf8', env, timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      complete({ status: error ? typeof error.code === 'number' ? error.code : null : 0, stdout, stderr });
    });
  });
}
const oldSha = 'a'.repeat(40), newSha = 'b'.repeat(40), roots: string[] = [];
afterEach(async () => {
  const created = roots.splice(0);
  await Promise.all(created.map(root => rm(root, { recursive: true, force: true })));
  const remaining = created.filter(root => existsSync(root));
  if (remaining.length) throw new Error(`scratch teardown left paths: ${remaining.join(', ')}`);
  // Optional evidence for receipt diagnosis; written only after all owned cleanup has completed.
  if (process.env.CORPUS_TEARDOWN_PROOF) appendFileSync(process.env.CORPUS_TEARDOWN_PROOF,
    JSON.stringify({ event: 'cleanup-complete', created, remaining, registeredRoots: roots.length }) + '\n');
});
function temp() { const path = mkdtempSync(join(tmpdir(), 'corpus-cli-generation-')); roots.push(path); return path; }
function put(root: string, path: string, bytes: string) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), bytes); }
function inventory(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const path = join(entry.parentPath, entry.name); return [path.slice(root.length + 1), readFileSync(path).toString('hex')];
  }).sort(([a], [b]) => a.localeCompare(b)));
}
function fixture() {
  const root = temp();
  const records: MountingRecord[] = ['changed', 'same'].map(name => ({ caseId: `a-${name}`, category: 'a', status: 'active', actionGroup: 'no-edit',
    fidelityTag: 'known-limitation', input: `no-edit/a/${name}/input.md`, expected: { serialized: `no-edit/a/${name}/expected.md` },
    desired: `no-edit/a/${name}/desired.md`, action: [], platform: 'any', baselineSha: oldSha, normalizations: [], rationale: `Authored ${name}.`,
    reason: 'Known loss.', limitRef: 'D197', guardedPaths: [{ path: 'src/empty.ts', receipt: 'MIG001-a-empty' }], consumers: [], negative: { kind: 'matchDesiredOnBaseline' } }));
  for (const record of records) { put(root, record.input, 'A\n'); put(root, record.expected.serialized, 'OLD\n'); put(root, record.desired!, 'DESIRED\n'); }
  put(root, 'a.json', canonicalJson(records)); return { root, records };
}
function result(record: CorpusRecord, serialized: string) {
  return { caseId: record.caseId, caseKind: 'mounting' as const, actual: { untouched: 'A\n', serialized }, report: {} };
}
const provenance = { mergeBase: () => newSha, verifyBaseline: (_sha: string) => {} };
it('compares independent trees byte-for-byte regardless of creation order without changing either', () => {
  const left = temp(), right = temp(); put(left, 'b.json', '[1,2]\n'); put(left, 'a.md', 'A\n'); put(right, 'a.md', 'A\n'); put(right, 'b.json', '[1,2]\n');
  const before = [inventory(left), inventory(right)]; expect(() => compareScratchTrees(left, right)).not.toThrow(); expect([inventory(left), inventory(right)]).toEqual(before);
});
it.each(['changed', 'missing', 'extra', 'observation', 'action order'] as const)('rejects scratch %s drift naming a path', kind => {
  const left = temp(), right = temp(); put(left, 'result.json', '{"action":[1,2],"observation":1}\n'); put(right, 'result.json', '{"action":[1,2],"observation":1}\n');
  if (kind === 'missing') rmSync(join(right, 'result.json'));
  else if (kind === 'extra') put(right, 'extra.md', 'X');
  else put(right, 'result.json', kind === 'action order' ? '{"action":[2,1],"observation":1}\n' : kind === 'observation' ? '{"action":[1,2],"observation":2}\n' : 'X');
  const before = [inventory(left), inventory(right)]; expect(() => compareScratchTrees(left, right)).toThrow(/result.json|extra.md/); expect([inventory(left), inventory(right)]).toEqual(before);
});
it('merges only generated expectations and canonical shards, retaining unchanged provenance and authored bytes', () => {
  const { root, records } = fixture(), scratch = temp(), before = inventory(root);
  writeScratchResult(scratch, records[0], result(records[0], 'NEW\n')); writeScratchResult(scratch, records[1], result(records[1], 'OLD\n'));
  expect(mergeScratch(root, scratch, { mergeBaseSha: newSha, verifyBaseline: provenance.verifyBaseline })).toEqual(['a-changed']);
  const merged = JSON.parse(readFileSync(join(root, 'a.json'), 'utf8'));
  expect(merged.map((r: MountingRecord) => r.baselineSha)).toEqual([newSha, oldSha]);
  expect(readFileSync(join(root, records[0].expected.serialized), 'utf8')).toBe('NEW\n');
  for (const record of records) { expect(readFileSync(join(root, record.input)).toString('hex')).toBe(before[record.input]); expect(readFileSync(join(root, record.desired!)).toString('hex')).toBe(before[record.desired!]); }
  expect(merged.map((r: MountingRecord) => r.rationale)).toEqual(['Authored changed.', 'Authored same.']);
  expect(readFileSync(join(root, 'a.json'), 'utf8')).toBe(canonicalJson(merged));
  const after = inventory(root); expect(mergeScratch(root, scratch, { mergeBaseSha: newSha, verifyBaseline: provenance.verifyBaseline })).toEqual([]); expect(inventory(root)).toEqual(after);
});
it.each(['input', 'desired', 'outside', 'absolute', 'symlink scratch', 'symlink target', 'unknown case', 'missing result', 'snapshot drift'] as const)('refuses %s output before any tracked mutation', kind => {
  const { root, records } = fixture(), scratch = temp();
  for (const record of records) writeScratchResult(scratch, record, result(record, 'NEW\n'));
  if (kind === 'symlink scratch') symlinkSync(root, join(scratch, 'escape'));
  else if (kind === 'symlink target') { rmSync(join(root, records[0].expected.serialized)); symlinkSync(join(root, records[0].input), join(root, records[0].expected.serialized)); }
  else if (kind === 'missing result') rmSync(join(scratch, 'results/a-same.json'), { force: true });
  else if (kind === 'snapshot drift') { const r = { ...records[0], rationale: 'Changed by child.' }; put(scratch, 'results/a-changed.json', canonicalJson({ caseId: r.caseId, record: r, actual: result(r, 'NEW\n').actual, report: {} })); }
  else if (kind === 'unknown case') put(scratch, 'results/a-other.json', '{}');
  else put(scratch, 'results/a-changed.json', canonicalJson({ caseId: records[0].caseId, record: records[0], actual: result(records[0], 'NEW\n').actual, report: {}, target: kind === 'input' ? records[0].input : kind === 'desired' ? records[0].desired : kind === 'outside' ? '../outside' : '/tmp/outside' }));
  const before = inventory(root); expect(() => mergeScratch(root, scratch, { mergeBaseSha: newSha, verifyBaseline: provenance.verifyBaseline })).toThrow(/output|scratch|symlink|snapshot|result|target|case/i); expect(inventory(root)).toEqual(before);
});
it('failed child cannot merge earlier successful case outputs', async () => {
  const { root, records } = fixture(), scratch = temp(), before = inventory(root);
  await expect(generateCorpus({ root, scratch, env: {} }, { ...provenance, runRunners: async request => {
    writeScratchResult(request.scratch, records[0], result(records[0], 'NEW\n')); throw new Error('runner failed');
  } })).rejects.toThrow(/runner failed/);
  expect(inventory(root)).toEqual(before);
});
it('local generation passes explicit safe write protocol and merges once after all results', async () => {
  const { root, records } = fixture(), scratch = temp(); let calls = 0;
  await generateCorpus({ root, scratch, env: {}, observations: { 'a-changed': ['selection'] } }, { ...provenance, runRunners: async request => {
    calls++; expect(request.env.CORPUS_WRITE).toBe('1'); expect(request.env.CORPUS_ROOT).toBe(root); expect(request.env.CORPUS_SCRATCH).toBe(scratch);
    expect(JSON.parse(request.env.CORPUS_CASE_IDS!)).toEqual(['a-changed', 'a-same']); expect(JSON.parse(request.env.CORPUS_OBSERVATIONS!)).toEqual({ 'a-changed': ['selection'] });
    for (const record of records) writeScratchResult(request.scratch, record, result(record, 'NEW\n'));
    expect(readFileSync(join(root, records[0].expected.serialized), 'utf8')).toBe('OLD\n');
  } });
  expect(calls).toBe(1); expect(readFileSync(join(root, records[0].expected.serialized), 'utf8')).toBe('NEW\n');
});
it.each(['1', 'true', ''] as const)('real generate CLI refuses any set CI=%j before files change', async value => {
  const { root } = fixture(), scratch = temp(), before = [inventory(root), inventory(scratch)];
  const output = await nodeCli([resolve('scripts/corpus/generate.mjs'), '--root', root, '--scratch', scratch], { ...process.env, CI: value });
  expect(output.status).not.toBe(0); expect(output.stderr).toMatch(/CI.*set|CI.*refus|refus.*CI/); expect([inventory(root), inventory(scratch)]).toEqual(before);
});
it('rejects malformed selection and bootstrap protocol before running a child', async () => {
  const { root } = fixture(), scratch = temp(); let called = false;
  const deps = { ...provenance, runRunners: async () => { called = true; } };
  for (const options of [{ caseIds: ['../escape'] }, { caseIds: ['a-absent'] }, { observations: { 'a-changed': ['unknown'] } }, { observations: { 'a-absent': ['selection'] } }]) {
    await expect(generateCorpus({ root, scratch, env: {}, ...options } as unknown as Parameters<typeof generateCorpus>[0], deps)).rejects.toThrow(/case|observation|selection/);
  }
  expect(called).toBe(false); expect(inventory(scratch)).toEqual({});
});
it('check CLI rejects a missing --root value rather than checking an accidental default root', async () => {
  const output = await nodeCli([resolve('scripts/corpus/check.mjs'), '--root']);
  expect(output.status).not.toBe(0); expect(output.stderr).toMatch(/--root.*value/);
});
