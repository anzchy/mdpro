// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { corpusImportViolations } from '../support/corpus/policy.ts';
function inventory(directory: string): { path: string; source: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? inventory(path) : /\.[cm]?[jt]sx?$/.test(path) ? [{ path, source: readFileSync(path, 'utf8') }] : [];
  });
}
it('checks the entire actual corpus graph and keeps the driver interface graph engine-neutral', () => {
  const files = inventory('tests/support/corpus');
  for (const path of readdirSync('tests')) if (/^corpus-.*\.[jt]sx?$/.test(path)) files.push({ path: 'tests/' + path, source: readFileSync('tests/' + path, 'utf8') });
  // CLI files join this graph as soon as WI6 creates its directory.
  if (readdirSync('scripts').includes('corpus')) files.push(...inventory('scripts/corpus'));
  expect(files.some(file => file.path === 'tests/support/corpus/types.ts')).toBe(true);
  expect(corpusImportViolations(files)).toEqual([]);
});
it.each([
  "import { rig as editor } from '../d188EmptyParagraphRig';",
  "import type { Rig } from '@/../tests/support/d194LinkDefinitionRig';",
  "export { createScriptedMilkdownRig as editor } from '../../helpers/scriptedMilkdownRig';",
  "const rig = import('../d188EmptyParagraphRig');",
  "const rig = require('../d194LinkDefinitionRig');",
  "import type { WysiwygEditorPort as Port } from '../../../src/services/editor/types';",
  "import { coordinator } from '@/services/editor/editorCoordinator';",
  "import type { Port } from '@port/types';",
])('rejects reduced rigs and the editor port: %s', source => {
  expect(corpusImportViolations([{ path: 'tests/support/corpus/driver.ts', source }], { aliases: { '@port/': 'src/services/editor/' } })).toHaveLength(1);
});
it('follows local interface barrels instead of checking only direct engine imports', () => {
  const files = [
    { path: 'tests/support/corpus/types.ts', source: "export type { State } from './internal.ts';" },
    { path: 'tests/support/corpus/internal.ts', source: "import type { EditorState as State } from '@milkdown/prose/state'; export type { State };" },
  ];
  expect(corpusImportViolations(files).some(error => error.includes('internal.ts') && error.includes('engine-neutral'))).toBe(true);
});
it.each(['@milkdown/core', '@milkdown/prose/model', 'prosemirror-state', '@tiptap/core', '@codemirror/state'])('rejects engine type %s in the driver interface', specifier => {
  expect(corpusImportViolations([{ path: 'tests/support/corpus/types.ts', source: `import type { State as Neutral } from '${specifier}';` }]).some(error => error.includes('engine-neutral'))).toBe(true);
});
it('allows production engine imports behind the driver and unrelated comments', () => {
  expect(corpusImportViolations([
    { path: 'tests/support/corpus/types.ts', source: 'export interface CorpusDriver { serialize(): Promise<string> }' },
    { path: 'tests/support/corpus/driver.ts', source: "// import '../d188EmptyParagraphRig' is forbidden\nimport { Editor } from '@milkdown/core';" },
  ])).toEqual([]);
});
it('resolves an aliased intermediate barrel to the forbidden port', () => {
  expect(corpusImportViolations([
    { path: 'tests/support/corpus/driver.ts', source: "import { make } from '@shared/port.ts';" },
    { path: 'tests/support/shared/port.ts', source: "export * from '@/services/editor/index';" },
  ], { aliases: { '@shared/': 'tests/support/shared/' } }).some(error => error.includes('editor port'))).toBe(true);
});
