// @vitest-environment node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { canonicalJson } from './support/corpus/canonical.ts';
import { sha256Hex } from './support/corpus/sha256.ts';

const node = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex');
const MANIFEST_ROOT = 'tests/fixtures/markdown-corpus';

// The recipe bytes every existing corpus test commits (no manifest under the fixture root has a guard-only case yet).
const COMMITTED_TEST_RECIPES = [
  ...[0, 1, 3].map(repeat => JSON.stringify({ text: '中文\n', repeat })), // corpus-content-observations
  'bad json', '{"text":"x","repeat":-1}', '{"text":"x","repeat":0.5}', '{"text":"x","repeat":1,"extra":true}',
  '{"text":1,"repeat":2}', '{"text":"x","repeat":9007199254740992}', // corpus-content-observations, malformed
  '{"text":"x","repeat":3}', '{"text":"x","repeat":3}\n', // corpus-runner, corpus-content-observations
  '{"kind":"repeat","text":"A","count":1}\n', // tooling/corpus-guard-metadata
  canonicalJson({ text: 'A\n', repeat: 1 }), // tooling/corpus-cli-check
];

function manifestRecipes(): string[] {
  const manifests = readdirSync(MANIFEST_ROOT).filter(name => /^[a-n]\.json$/.test(name));
  expect(manifests.length).toBeGreaterThan(0);
  return manifests.flatMap(name => (JSON.parse(readFileSync(`${MANIFEST_ROOT}/${name}`, 'utf8')) as { caseKind?: string; recipe?: { path: string } }[])
    .filter(record => record.caseKind === 'guard-only' && record.recipe)
    .map(record => readFileSync(`${MANIFEST_ROOT}/${record.recipe!.path}`, 'utf8')));
}

it('matches node:crypto on every committed recipe', () => {
  const recipes = [...COMMITTED_TEST_RECIPES, ...manifestRecipes()];
  expect(recipes.map(sha256Hex)).toEqual(recipes.map(recipe => node(recipe)));
});

it('matches node:crypto on the empty input, as a string and as bytes', () => {
  expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256Hex(new Uint8Array(0))).toBe(node(''));
});

it.each([1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 1_000_000])('matches node:crypto on a %i-byte input across block and padding boundaries', length => {
  const text = Array.from({ length }, (_, index) => String.fromCharCode(97 + (index % 26))).join('');
  expect(sha256Hex(text)).toBe(node(text));
});

it.each(['中文\n', 'é', '👩‍👩‍👧', '﻿bom-led\n', 'lone \uD800 surrogate', '\uDC00', '字'.repeat(40)])('hashes non-ASCII text as UTF-8 exactly as node:crypto update(string) does: %j', text => {
  expect(sha256Hex(text)).toBe(node(text));
});

it('hashes raw bytes, including 0x00 and 0xFF, and returns 64 lowercase hex digits', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, index) => (index * 167 + 13) & 0xff);
  bytes[0] = 0x00; bytes[1] = 0xff;
  expect(sha256Hex(bytes)).toBe(node(bytes));
  expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
});
