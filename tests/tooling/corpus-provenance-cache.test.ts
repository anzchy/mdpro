// @vitest-environment node
/** Provenance runs git a bounded number of times per checker run, however many records share a baseline SHA. */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
const RECORDS = 45;
const MESSAGE = 'baselineSha must name an existing master commit';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function spawn(file: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<string> {
  return new Promise((done, fail) => execFile(file, args, { ...options, encoding: 'utf8' },
    (error, stdout, stderr) => error ? fail(new Error(stderr || error.message)) : done(stdout.trim())));
}
// A scratch repository holding a copy of provenance.ts, so repositoryRoot is this repository and its refs are ours to shape.
async function scratchRepository(branch: string) {
  const root = mkdtempSync(join(tmpdir(), 'corpus-provenance-')); roots.push(root);
  const realGit = await spawn('/usr/bin/env', ['which', 'git'], { cwd: root });
  const run = (args: string[]) => spawn(realGit, args, { cwd: root });
  await run(['init', '-q', '-b', branch]);
  await run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base']);
  mkdirSync(join(root, 'scripts/corpus'), { recursive: true });
  copyFileSync(resolve('scripts/corpus/provenance.ts'), join(root, 'scripts/corpus/provenance.ts'));
  // The process boundary: a git shim on PATH logs every spawn and hands it to the real git.
  const shimDirectory = join(root, 'shim'), log = join(root, 'git-calls.log');
  mkdirSync(shimDirectory);
  writeFileSync(join(shimDirectory, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${realGit}' "$@"\n`);
  chmodSync(join(shimDirectory, 'git'), 0o755);
  return { root, head: await run(['rev-parse', 'HEAD']), log, shimDirectory };
}
// One process, like one checker run: verify the same SHA once per record and report each outcome.
async function verifyEveryRecord(repository: Awaited<ReturnType<typeof scratchRepository>>): Promise<{ outcomes: string[]; calls: string[] }> {
  const script = `import { verifyBaseline } from ${JSON.stringify(join(repository.root, 'scripts/corpus/provenance.ts'))};
const outcomes = [];
for (let index = 0; index < ${RECORDS}; index++) { try { verifyBaseline(${JSON.stringify(repository.head)}); outcomes.push('ok'); } catch (error) { outcomes.push(error.message); } }
process.stdout.write(JSON.stringify(outcomes));`;
  const env = { ...process.env, PATH: `${repository.shimDirectory}:${process.env.PATH}` };
  const stdout = await spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: repository.root, env });
  return {
    outcomes: JSON.parse(stdout),
    calls: existsSync(repository.log) ? readFileSync(repository.log, 'utf8').trim().split('\n').filter(Boolean) : [],
  };
}
it('with no base ref, 45 records sharing one SHA run git a constant number of times and each gets the same message', async () => {
  const repository = await scratchRepository('trunk');
  const { outcomes, calls } = await verifyEveryRecord(repository);
  expect(outcomes).toEqual(Array(RECORDS).fill(MESSAGE));
  expect(calls.length, `${calls.length} git calls, first: ${calls.slice(0, 4).join(' | ')}`).toBeLessThanOrEqual(3);
}, 30_000);
it('with a local master, 45 records sharing one SHA are each accepted with a constant number of git runs', async () => {
  const repository = await scratchRepository('master');
  const { outcomes, calls } = await verifyEveryRecord(repository);
  expect(outcomes).toEqual(Array(RECORDS).fill('ok'));
  expect(calls.length, `${calls.length} git calls, first: ${calls.slice(0, 4).join(' | ')}`).toBeLessThanOrEqual(3);
}, 30_000);
