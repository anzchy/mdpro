// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { loadInBareRealm, NODE_ONLY_ABSENT, settle } from './helpers/corpusBrowserBundle.ts';
import { expandRecipe } from './support/corpus/recipes.ts';

type Recipes = { expandRecipe: typeof expandRecipe };
const node = (input: string) => createHash('sha256').update(input).digest('hex');
const loading = settle(loadInBareRealm<Recipes>('tests/support/corpus/recipes.ts'));
// The browser realm's Error is not this realm's Error, so the message is read structurally.
const outcome = (run: () => string) => { try { return { value: run() }; } catch (error) { return { error: String((error as { message?: unknown }).message) }; } };

it('recipes.ts loads in a realm with no process, Buffer or require, with its exports unchanged, and expands a checked recipe there', async () => {
  const { module, failure } = await loading;
  expect(failure).toBeUndefined();
  expect(module!.inputs.filter(input => input.startsWith('node:'))).toEqual([]);
  expect(module!.nodeOnlyGlobals).toBe(NODE_ONLY_ABSENT);
  expect(Object.keys(module!.exports).sort()).toEqual(['expandRecipe']);
  expect(module!.exports.expandRecipe.length).toBe(3);
  const long = JSON.stringify({ text: '中文\n'.repeat(40), repeat: 2 }), short = '{"text":"中","repeat":2}';
  const browser = module!.exports.expandRecipe;
  const cases: [string, string][] = [[short, node(short)], [long, node(long)], [short + '\n', node(short)], ['{"text":"x","repeat":-1}', node('{"text":"x","repeat":-1}')]];
  expect(cases.map(([bytes, sha]) => outcome(() => browser(bytes, sha, 'm-r')))).toEqual([
    { value: '中中' }, { value: '中文\n'.repeat(80) }, { error: 'm-r: recipe sha256 mismatch' },
    { error: 'm-r: recipe requires exactly text and a safe nonnegative integer repeat' },
  ]);
  expect(cases.map(([bytes, sha]) => outcome(() => expandRecipe(bytes, sha, 'm-r')))).toEqual(cases.map(([bytes, sha]) => outcome(() => browser(bytes, sha, 'm-r'))));
});
