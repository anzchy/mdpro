// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { corpusPlacementViolations } from '../support/corpus/policy.ts';
const setup = "Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });\n";
const runner = 'tests/corpus-a-empty-paragraphs.any.test.tsx';
function files(directory: string): { path: string; source: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(?:tsx?|mjs)$/.test(path) ? [{ path, source: readFileSync(path, 'utf8') }] : [];
  });
}
it('checks actual corpus source and tooling placement in the discoverable unit tree', () => {
  const inventory = [...files('tests/support/corpus'), ...files('tests/tooling').filter(file => file.path.includes('/corpus-'))];
  for (const file of files('tests').filter(file => /^tests\/corpus-/.test(file.path))) inventory.push(file);
  if (readdirSync('scripts').includes('corpus')) inventory.push(...files('scripts/corpus'));
  expect(inventory.some(file => file.path === 'tests/tooling/corpus-placement.test.ts')).toBe(true);
  expect(corpusPlacementViolations(inventory)).toEqual([]);
});
it('accepts approved runners, support, CLI, tooling and fixture paths', () => {
  expect(corpusPlacementViolations([
    { path: runner, source: setup + "const driver = await import('./support/corpus/driver.ts');" },
    { path: 'tests/corpus-a-empty-paragraphs.win.test.tsx', source: setup.replace('MacIntel', 'Win32') },
    { path: 'tests/corpus-a-empty-paragraphs.mac.slow.test.tsx', source: setup },
    { path: 'tests/support/corpus/driver.ts', source: '' },
    { path: 'tests/tooling/corpus-manifest.test.ts', source: "import { check } from '../support/corpus/metadata.ts';" },
    { path: 'scripts/corpus/check.mjs', source: '' },
    { path: 'tests/fixtures/markdown-corpus/no-edit/a/input.md', source: 'A\n' },
  ])).toEqual([]);
});
it('accepts pure corpus behavior tests at the tests root without treating them as platform runners', () => {
  expect(corpusPlacementViolations([
    { path: 'tests/corpus-comparator.test.ts', source: "import { compareCase } from './support/corpus/comparator.ts';" },
    { path: 'tests/corpus-reference-transforms.test.ts', source: "import { normalize } from './support/corpus/normalizations.ts';" },
  ])).toEqual([]);
});
it.each([
  'tests/nested/corpus-a-empty-paragraphs.any.test.tsx',
  'src/corpus-a-empty-paragraphs.any.test.tsx',
  'tests/corpus-a-empty-paragraphs.test.tsx',
  'tests/corpus-a-empty-paragraphs.linux.test.tsx',
  'tests/corpus-z-empty-paragraphs.any.test.tsx',
  'tests/tooling/corpus-a-empty-paragraphs.any.test.tsx',
])('rejects misplaced or undiscoverable runner %s', path => {
  expect(corpusPlacementViolations([{ path, source: setup }]).some(message => message.includes(path) && message.includes('runner'))).toBe(true);
});
it('requires platform injection before imports and rejects platform skips', () => {
  for (const source of ['', "import './support/corpus/driver.ts';\n" + setup, setup + "it.skipIf(true)('case', () => {});"]) {
    expect(corpusPlacementViolations([{ path: runner, source }]).some(message => message.includes('platform'))).toBe(true);
  }
});
it('requires production origin for the activation runner and category j', () => {
  for (const path of ['tests/corpus-a-link-driver.any.test.tsx', 'tests/corpus-j-links.any.test.tsx']) {
    expect(corpusPlacementViolations([{ path, source: setup + "const action = {kind: 'activateLink'};" }]).some(message => message.includes('origin'))).toBe(true);
    expect(corpusPlacementViolations([{ path, source: '/** @vitest-' + 'environment-options { "url": "tauri://localhost/" } */\n' + setup + "const action = {kind: 'activateLink'};" }])).toEqual([]);
  }
});
it('keeps tests reaching product source out of tooling, including through a local barrel', () => {
  expect(corpusPlacementViolations([
    { path: 'tests/tooling/corpus-driver.test.ts', source: "import { make } from '../support/corpus/driver.ts';" },
    { path: 'tests/support/corpus/driver.ts', source: "import { MilkdownEditor } from '@/components/Editor/MilkdownEditor';" },
  ]).some(message => message.includes('tests/tooling/corpus-driver.test.ts') && message.includes('src'))).toBe(true);
});
