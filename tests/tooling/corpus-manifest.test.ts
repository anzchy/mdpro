// @vitest-environment node
/** Real category-a inventory is checked read-only, including the exact delivered topic cases. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { expect, it } from 'vitest';
import { checkCorpus, loadCorpus } from '../../scripts/corpus/core.ts';
const root = resolve('tests/fixtures/markdown-corpus');
function snapshot(): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(root, path)] = readFileSync(path).toString('base64');
    }
  }
  if (existsSync(root)) walk(root);
  return files;
}
it('validates all real category-a records without changing any fixture byte', () => {
  const before = snapshot();
  expect(checkCorpus(root)).toEqual([]);
  expect(loadCorpus(root).records.map(record => record.caseId).sort()).toEqual([
    'a-c7-list-merge', 'a-code-gap', 'a-edge-blanks', 'a-heading-gap', 'a-list-gap', 'a-many-blanks',
    'a-neighbor-edit', 'a-neighbor-undo', 'a-one-blank', 'a-quote-gap', 'a-trailing-quote-enter',
    'a-two-blanks', 'a-whitespace-lines', 'a-zero-blanks',
  ]);
  expect(snapshot()).toEqual(before);
});
