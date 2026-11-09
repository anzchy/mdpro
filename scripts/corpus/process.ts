/** Declared subprocess boundary. Tests inject prepared outputs; the default runs only canonical category runners. */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCorpus } from './core.ts';
import { repositoryRoot } from './provenance.ts';
import type { RunnerRequest } from './generation.ts';
export async function runRunners(request: RunnerRequest): Promise<void> {
  const data = loadCorpus(request.root), names = readdirSync(join(repositoryRoot, 'tests'));
  const selected = new Set<string>();
  for (const record of data.records.filter(record => request.caseIds.includes(record.caseId))) {
    const platform = record.caseKind === 'guard-only' ? 'any' : record.platform;
    const slow = record.ci === 'local-only';
    const candidates = names.filter(name => {
      const match = name.match(/^corpus-([a-n])-([a-z0-9-]+)\.(any|mac|win)(\.slow)?\.test\.tsx$/);
      return match && match[1] === record.category && !match[2].startsWith('driver-') && match[3] === platform && !!match[4] === slow;
    });
    if (!candidates.length) throw new Error(`${record.caseId}: no category/platform runner`);
    candidates.forEach(name => selected.add('tests/' + name));
  }
  for (const slow of [false, true]) {
    const files = [...selected].filter(path => path.includes('.slow.test.') === slow).sort();
    if (!files.length) continue;
    const args = ['pnpm', 'exec', 'vitest', 'run', ...(slow ? ['--config', 'vitest.slow.config.ts'] : []), ...files];
    await new Promise<void>((resolve, reject) => {
      const child = spawn('scripts/heavy-lock.sh', args, { cwd: repositoryRoot, env: { ...request.env, VITEST_MAX_WORKERS: '2' }, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`corpus runner failed: ${signal ?? code}`)));
    });
  }
}
