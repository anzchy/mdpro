// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadInBareRealm, NODE_ONLY_ABSENT } from './helpers/corpusBrowserBundle.ts';

type Sha = { sha256Hex(input: string | Uint8Array): string };
const node = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex');
const loading = loadInBareRealm<Sha>('tests/support/corpus/sha256.ts');
const ascii = (length: number) => Array.from({ length }, (_, index) => String.fromCharCode(97 + (index % 26))).join('');

it('loads in a realm with no process, Buffer or require, from a bundle with no node: input', async () => {
  const { inputs, nodeOnlyGlobals, exports } = await loading;
  expect(inputs.filter(input => input.startsWith('node:'))).toEqual([]);
  expect(nodeOnlyGlobals).toBe(NODE_ONLY_ABSENT);
  expect(Object.keys(exports).sort()).toEqual(['sha256Hex']);
});

it('the pure digest equals node:crypto inside that realm for every boundary and non-ASCII vector', async () => {
  const { exports } = await loading;
  const strings = ['', ...[1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 1_000_000].map(ascii),
    '中文\n', 'é', '👩‍👩‍👧', '﻿bom-led\n', 'lone \uD800 surrogate', '\uDC00'];
  expect(strings.map(text => exports.sha256Hex(text))).toEqual(strings.map(text => node(text)));
  const bytes = Uint8Array.from({ length: 300 }, (_, index) => (index * 167 + 13) & 0xff);
  expect([exports.sha256Hex(new Uint8Array(0)), exports.sha256Hex(bytes)]).toEqual([node(new Uint8Array(0)), node(bytes)]);
});

it('the module source names no Node-only API, so no realm switch can route around the pure path', () => {
  const source = readFileSync('tests/support/corpus/sha256.ts', 'utf8');
  expect(source.match(/\b(?:process|Buffer|createHash|getBuiltinModule|require)\b|node:/g) ?? []).toEqual([]);
});
