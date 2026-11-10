// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { spawnBudget } from '../support/spawnBudget.ts';
import { canonicalJson } from '../support/corpus/canonical.ts';
const CHILD_TIMEOUT_MS = 2_000;
// execFile completes after the child closes; its bounded timeout kills and drains this owned Node child.
function nodeCli(args: string[], env = process.env): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(complete => {
    execFile(process.execPath, args, { encoding: 'utf8', env, timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      complete({ status: error ? typeof error.code === 'number' ? error.code : null : 0, stdout, stderr });
    });
  });
}
const baseline = 'f4fc6746de7cca3d0e0c66c2281542c5b9463772';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'corpus-cli-check-')); roots.push(root);
  const record: Record<string, any> = { caseId: 'a-example', category: 'a', status: 'active', actionGroup: 'no-edit', fidelityTag: 'immutable',
    input: 'no-edit/a/example/input.md', expected: { serialized: 'no-edit/a/example/expected.md' }, action: [], platform: 'any',
    baselineSha: baseline, normalizations: [], rationale: 'Preserve authored bytes.', guardedPaths: [{ path: 'src/example.ts', receipt: 'MIG001-a-example' }],
    negative: { kind: 'corruptSerialized' }, consumers: ['MIG-002'] };
  const put = (path: string, bytes: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), bytes); };
  put(record.input, 'A\n'); put(record.expected.serialized, 'A\n');
  const save = (records = [record]) => put('a.json', canonicalJson(records)); save();
  return { root, record, put, save };
}
function check(root: string) { return nodeCli([resolve('scripts/corpus/check.mjs'), '--root', root]); }
function inventory(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const path = join(entry.parentPath, entry.name); return [path.slice(root.length + 1), readFileSync(path).toString('hex')];
  }).sort(([a], [b]) => a.localeCompare(b)));
}
it('real Node checker accepts a valid explicit root twice without writing a byte or file', async () => {
  const f = fixture(), before = inventory(f.root);
  expect((await check(f.root)).status).toBe(0); expect((await check(f.root)).status).toBe(0); expect(inventory(f.root)).toEqual(before);
}, spawnBudget(238));
it('checker accepts origin/master in a detached checkout without a local master', async () => {
  const clone = mkdtempSync(join(tmpdir(), 'corpus-detached-')); roots.push(clone);
  const git = (args: string[]) => new Promise<string>((done, fail) => execFile('git', args, { cwd: clone, encoding: 'utf8' },
    (error, stdout) => error ? fail(error) : done(stdout)));
  await git(['init', '-q']); await git(['remote', 'add', 'origin', resolve('.')]);
  const master = await new Promise<string>((done, fail) => execFile('git', ['rev-parse', 'refs/remotes/origin/master'],
    { encoding: 'utf8' }, (error, stdout) => error ? fail(error) : done(stdout.trim())));
  await git(['fetch', '-q', 'origin', master]); await git(['update-ref', 'refs/remotes/origin/master', master]);
  await git(['fetch', '-q', 'origin', 'HEAD']);
  await git(['checkout', '-q', '--detach', 'FETCH_HEAD']);
  copyFileSync(resolve('scripts/corpus/provenance.ts'), join(clone, 'scripts/corpus/provenance.ts'));
  await expect(git(['show-ref', '--verify', 'refs/heads/master'])).rejects.toThrow();
  await git(['show-ref', '--verify', 'refs/remotes/origin/master']);
  const fixtureRoot = join(clone, 'tests/fixtures/markdown-corpus'), before = inventory(fixtureRoot);
  const output = await nodeCli([join(clone, 'scripts/corpus/check.mjs'), '--root', fixtureRoot]);
  expect(output.status).toBe(0);
  expect(output.stdout).toContain('corpus check passed');
  expect(inventory(fixtureRoot)).toEqual(before);
  const oldest = (await git(['rev-list', '--max-parents=0', 'HEAD'])).trim();
  await git(['tag', 'master', oldest]);
  const withConflictingTag = await nodeCli([join(clone, 'scripts/corpus/check.mjs'), '--root', fixtureRoot]);
  expect(withConflictingTag.status).toBe(0);
  expect(inventory(fixtureRoot)).toEqual(before);
  await git(['update-ref', '-d', 'refs/remotes/origin/master']);
  const missingRefs = await nodeCli([join(clone, 'scripts/corpus/check.mjs'), '--root', fixtureRoot]);
  expect(missingRefs.status).not.toBe(0);
  expect(missingRefs.stderr).toMatch(/baselineSha must name an existing master commit/);
  await git(['update-ref', 'refs/heads/master', oldest]);
  const localPrecedence = await nodeCli([join(clone, 'scripts/corpus/check.mjs'), '--root', fixtureRoot]);
  expect(localPrecedence.status).not.toBe(0);
  expect(localPrecedence.stderr).toMatch(/baselineSha must name an existing master commit/);
}, 30_000);
it.each([
  ['unlisted', (f: ReturnType<typeof fixture>) => f.put('extra.md', 'extra'), /extra.md.*unlisted/],
  ['missing', (f: ReturnType<typeof fixture>) => rmSync(join(f.root, f.record.expected.serialized)), /a-example.*missing/],
  ['duplicate id', (f: ReturnType<typeof fixture>) => f.save([f.record, f.record]), /a-example.*duplicate/],
  ['malformed id', (f: ReturnType<typeof fixture>) => { f.record.caseId = 'INVALID'; f.save(); }, /INVALID.*caseId/],
  ...[['category', 'b'], ['status', 'pending'], ['ci', 'skip'], ['platform', 'linux'], ['fidelityTag', 'lossless'],
    ['actionGroup', 'invented'], ['normalizations', ['N9']], ['negative', { kind: 'unknown' }], ['negative', undefined],
    ['rationale', ''], ['baselineSha', undefined], ['baselineSha', '0'.repeat(40)]].map(([field, value]) =>
    [String(field) + "=" + JSON.stringify(value), (f: ReturnType<typeof fixture>) => { f.record[String(field)] = value; f.save(); }, new RegExp('a-example.*' + (field === 'baselineSha' ? 'baselineSha|master' : String(field)))]),
  ['action', (f: ReturnType<typeof fixture>) => { f.record.action = { kind: 'invented' }; f.save(); }, /a-example.*action/],
  ['directory', (f: ReturnType<typeof fixture>) => { f.record.input = 'edited/a/input.md'; f.put(f.record.input, 'A\n'); rmSync(join(f.root, 'no-edit/a/example/input.md')); f.save(); }, /a-example.*directory/],
  ['immutable bytes', (f: ReturnType<typeof fixture>) => f.put(f.record.expected.serialized, 'B\n'), /a-example.*immutable/],
  ['semantic empty', (f: ReturnType<typeof fixture>) => { f.record.fidelityTag = 'semantic-roundtrip'; f.save(); }, /a-example.*normalizations/],
  ['nonminimal', (f: ReturnType<typeof fixture>) => { f.record.fidelityTag = 'semantic-roundtrip'; f.record.normalizations = ['N3', 'N4']; f.put(f.record.input, 'A'); f.save(); }, /a-example.*minimal/],
  ['unknown observation', (f: ReturnType<typeof fixture>) => { f.record.expected.observation = 'no-edit/a/example/expected.json'; f.put(f.record.expected.observation, '{"unknown":{}}'); f.save(); }, /a-example.*observation/],
  ['canonical keys', (f: ReturnType<typeof fixture>) => f.put('a.json', JSON.stringify([f.record])), /a.json.*canonical/],
] as [string, (f: ReturnType<typeof fixture>) => void, RegExp][])('real checker rejects independent %s rule and stays read-only', async (_name, alter, diagnostic) => {
  const f = fixture(); alter(f); const before = inventory(f.root), result = await check(f.root);
  expect(result.status).not.toBe(0); expect(result.stderr).toMatch(diagnostic); expect(inventory(f.root)).toEqual(before);
}, spawnBudget(250));
it.each(['desired', 'reason', 'limitRef'] as const)('requires known-limitation %s', async field => {
  const f = fixture(); Object.assign(f.record, { fidelityTag: 'known-limitation', desired: 'no-edit/a/example/desired.md', reason: 'Known loss.', limitRef: 'D197' });
  f.put(f.record.desired, 'B\n'); delete f.record[field]; if (field === 'desired') rmSync(join(f.root, 'no-edit/a/example/desired.md')); f.save();
  const result = await check(f.root); expect(result.status).not.toBe(0); expect(result.stderr).toMatch(new RegExp('a-example.*' + field));
}, spawnBudget(226));
it('rejects pending even when every limitation file and field exists', async () => {
  const f = fixture(); Object.assign(f.record, { fidelityTag: 'known-limitation', desired: 'no-edit/a/example/desired.md', reason: 'Question.', limitRef: 'pending' });
  f.put(f.record.desired, 'B\n'); f.save(); const result = await check(f.root); expect(result.status).not.toBe(0); expect(result.stderr).toMatch(/a-example.*pending/);
}, spawnBudget(211));
it('validates a guard-only checksum and full decision through real Node', async () => {
  const f = fixture(); rmSync(join(f.root, 'no-edit'), { recursive: true }); rmSync(join(f.root, 'a.json'));
  const recipe = canonicalJson({ text: 'A\n', repeat: 1 });
  f.put('guard-only/m/recipe.json', recipe);
  const record = { caseId: 'm-guard', category: 'm', caseKind: 'guard-only', status: 'active', baselineSha: baseline,
    rationale: 'Characterize the guard.', guardedPaths: [{ path: 'src/example.ts', receipt: 'MIG001-m-guard' }], consumers: [], viewMode: 'wysiwyg',
    recipe: { path: 'guard-only/m/recipe.json', sha256: createHash('sha256').update(recipe).digest('hex') }, expected: { observation: { action: 'allow' } }, negative: { kind: 'wrongObservation' } };
  f.put('m.json', canonicalJson([record])); expect((await check(f.root)).status).toBe(0);
  record.recipe.sha256 = '0'.repeat(64); f.put('m.json', canonicalJson([record])); const result = await check(f.root);
  expect(result.status).not.toBe(0); expect(result.stderr).toMatch(/m-guard.*sha256/);
}, spawnBudget(360));
it('rejects an empty corpus and category shard mismatch', async () => {
  const f = fixture(); f.put('a.json', canonicalJson([])); let result = await check(f.root); expect(result.status).not.toBe(0); expect(result.stderr).toMatch(/empty|no cases/);
  f.put('b.json', canonicalJson([f.record])); rmSync(join(f.root, 'a.json')); result = await check(f.root); expect(result.status).not.toBe(0); expect(result.stderr).toMatch(/a-example.*shard/);
}, spawnBudget(211));
