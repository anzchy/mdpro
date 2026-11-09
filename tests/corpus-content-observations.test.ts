import { beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { FakeTauriBoundary } from './support/corpus/fakeBoundary.ts';
import { installCorpusBoundary } from './support/corpus/boundaryMocks.ts';
import { observeContent } from './support/corpus/contentObservations.ts';
import { expandRecipe } from './support/corpus/recipes.ts';
beforeEach(() => { installCorpusBoundary(new FakeTauriBoundary()); });
const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
it('calls the production TOC with fresh heading identities and code exclusion', async () => {
  const text = '# Alpha\n\n## 中文\n\n# Alpha\n\n```\n# hidden\n```\n';
  const headings = [{ level: 1, text: 'Alpha', id: 'alpha' }, { level: 2, text: '中文', id: '中文' }, { level: 1, text: 'Alpha', id: 'alpha-1' }];
  expect(await observeContent('toc', text, 'wysiwyg')).toEqual(headings);
  expect(await observeContent('toc', text, 'source')).toEqual(headings);
});
it('observes supplied serialized content rather than an earlier input heading', async () => {
  expect(await observeContent('toc', '# Edited\n', 'wysiwyg')).toEqual([{ level: 1, text: 'Edited', id: 'edited' }]);
});
it.each([
  ['wysiwyg', 'small\n', { action: 'allow' }], ['source', 'small\n', { action: 'allow' }],
  ['wysiwyg', '\n'.repeat(25001), { action: 'degrade-to-source', message: 'This document is too complex for WYSIWYG. Switched to Source mode for performance.', elements: 25001, longestLine: 0, trigger: 'structure' }],
  ['wysiwyg', 'x'.repeat(1000001), { action: 'degrade-to-source', message: 'This document is too complex for WYSIWYG. Switched to Source mode for performance.', elements: 0, longestLine: 1000001, trigger: 'line-length' }],
  ['wysiwyg', 'x'.repeat(1000001) + '\n'.repeat(25001), { action: 'degrade-to-source', message: 'This document is too complex for WYSIWYG. Switched to Source mode for performance.', elements: 25001, longestLine: 1000001, trigger: 'both' }],
  ['source', '|x\n'.repeat(50001), { action: 'withhold-table-extensions', message: 'This document has too many table rows. Table editing tools are turned off for it.', tableRows: 50001 }],
] as const)('keeps the complete production guard union %# in %s', async (mode, text, result) => {
  expect(await observeContent('largeDocGuard', text, mode)).toEqual(result);
});
it('expands an authenticated closed JSON recipe exactly, including zero repeats', () => {
  for (const repeat of [0, 1, 3]) {
    const bytes = JSON.stringify({ text: '中文\n', repeat }); expect(expandRecipe(bytes, sha(bytes), 'm-recipe')).toBe('中文\n'.repeat(repeat));
  }
});
it.each(['bad json', '{"text":"x","repeat":-1}', '{"text":"x","repeat":0.5}', '{"text":"x","repeat":1,"extra":true}', '{"text":1,"repeat":2}', '{"text":"x","repeat":9007199254740992}'])('rejects malformed recipes with the case id %s', bytes => {
  expect(() => expandRecipe(bytes, sha(bytes), 'm-recipe')).toThrow('m-recipe');
});
it('checks the exact committed bytes before interpreting the recipe', () => {
  const bytes = '{"text":"x","repeat":3}';
  expect(() => expandRecipe(bytes + '\n', sha(bytes), 'm-recipe')).toThrow(/m-recipe.*sha256/i);
});
