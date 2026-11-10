/** Read-only Git provenance is evaluated in this source checkout, never in a caller's fixture directory. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultFixtureRoot = resolve(repositoryRoot, 'tests/fixtures/markdown-corpus');
function git(args: string[]): string { return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
const PROVENANCE_ERROR = 'baselineSha must name an existing master commit';
// Each checker run is one process and never moves a ref, so a ref probe and a SHA check run once each, failures included.
let baseRefOutcome: { ref: string } | { missing: true } | undefined;
const baselineOutcomes = new Map<string, boolean>();
function baseRef(): string {
  baseRefOutcome ??= probeBaseRef();
  if ('missing' in baseRefOutcome) throw new Error(PROVENANCE_ERROR);
  return baseRefOutcome.ref;
}
function probeBaseRef(): { ref: string } | { missing: true } {
  for (const ref of ['refs/heads/master', 'refs/remotes/origin/master']) {
    try { git(['show-ref', '--verify', ref]); return { ref }; } catch { /* Try the next exact ref. */ }
  }
  return { missing: true };
}
export function verifyBaseline(sha: string): void {
  let accepted = baselineOutcomes.get(sha);
  if (accepted === undefined) { accepted = isMasterCommit(sha); baselineOutcomes.set(sha, accepted); }
  if (!accepted) throw new Error(PROVENANCE_ERROR);
}
function isMasterCommit(sha: string): boolean {
  try {
    if (!/^[a-f0-9]{40}$/i.test(sha) || git(['cat-file', '-t', sha]) !== 'commit') return false;
    git(['merge-base', '--is-ancestor', sha, baseRef()]);
    return true;
  } catch { return false; }
}
export function mergeBase(): string { const sha = git(['merge-base', 'HEAD', baseRef()]); verifyBaseline(sha); return sha; }
