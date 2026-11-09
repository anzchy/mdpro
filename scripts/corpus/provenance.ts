/** Read-only Git provenance is evaluated in this source checkout, never in a caller's fixture directory. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultFixtureRoot = resolve(repositoryRoot, 'tests/fixtures/markdown-corpus');
function git(args: string[]): string { return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
export function verifyBaseline(sha: string): void {
  try {
    if (!/^[a-f0-9]{40}$/i.test(sha) || git(['cat-file', '-t', sha]) !== 'commit') throw new Error('not a commit');
    git(['merge-base', '--is-ancestor', sha, 'master']);
  } catch { throw new Error('baselineSha must name an existing master commit'); }
}
export function mergeBase(): string { const sha = git(['merge-base', 'HEAD', 'master']); verifyBaseline(sha); return sha; }
