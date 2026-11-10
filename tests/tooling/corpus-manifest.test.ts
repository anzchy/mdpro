// @vitest-environment node
/** Real category-a and category-l inventories are checked read-only, including the exact delivered topic cases. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { expect, it } from 'vitest';
import { spawnBudget } from '../support/spawnBudget.ts';
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
it('validates all real category-a and category-l records without changing any fixture byte', () => {
  const before = snapshot();
  expect(checkCorpus(root)).toEqual([]);
  expect(loadCorpus(root).records.map(record => record.caseId).sort()).toEqual([
    'a-c7-list-merge', 'a-code-gap', 'a-edge-blanks', 'a-heading-gap', 'a-list-gap', 'a-many-blanks',
    'a-neighbor-edit', 'a-neighbor-undo', 'a-one-blank', 'a-quote-gap', 'a-quote-then-block', 'a-trailing-quote-enter',
    'a-two-blanks', 'a-whitespace-lines', 'a-zero-blanks',
    'l-block-start-feff', 'l-cjk-enter', 'l-cjk-punctuation', 'l-cjk-strong', 'l-cjk-strong-punct',
    'l-cjk-strong-punct-end', 'l-cjk-type', 'l-code-unicode', 'l-combining-marks', 'l-combining-type',
    'l-decoded-line-endings', 'l-emoji-edges', 'l-emoji-flags-keycaps', 'l-emoji-skin-tones', 'l-emoji-surrogates',
    'l-emoji-zwj', 'l-flag-type-between', 'l-fullwidth-doc-edges', 'l-fullwidth-spaces', 'l-fullwidth-type',
    'l-heading-emoji-only', 'l-inner-feff', 'l-leading-bom', 'l-leading-bom-edit', 'l-skin-tone-delete',
    'l-table-wide-chars', 'l-unicode-containers', 'l-zwj-delete', 'l-zwj-delete-undo', 'l-zwj-type-after',
  ]);
  expect(snapshot()).toEqual(before);
}, spawnBudget(92));
