// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalJson } from '../support/corpus/canonical.ts';
import { validateManifest, validateRecord } from '../support/corpus/metadata.ts';
import { ACTION_KINDS, OBSERVATION_KINDS, NORMALIZATION_IDS, NEGATIVE_KINDS } from '../support/corpus/vocabulary.ts';

const root = mkdtempSync(join(tmpdir(), 'corpus-metadata-'));
const paths = ['no-edit/a/input.md', 'no-edit/a/expected.md', 'no-edit/a/desired.md', 'no-edit/a/expected.json'];
const contents = ['A\n', 'A\n', 'B\n', '{"selection":{"text":""}}\n'];
const files: Record<string, string> = {};
paths.forEach((path, index) => {
  const disk = join(root, String(index));
  writeFileSync(disk, contents[index]);
  files[path] = readFileSync(disk, 'utf8');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const context = { files };
function record(): Record<string, any> {
  return {
    caseId: 'a-example', category: 'a', actionGroup: 'no-edit', fidelityTag: 'immutable',
    status: 'active', input: paths[0], expected: { serialized: paths[1] }, action: [],
    platform: 'any', baselineSha: 'a'.repeat(40), normalizations: [],
    rationale: 'Preserve the authored bytes.', guardedPaths: [{ path: 'src/plugins/milkdown/empty.ts', receipt: 'MIG001-a-empty' }],
    negative: { kind: 'alterByte' }, consumers: ['MIG-002c', 'MIG-009a'],
    derivedFrom: 'tests/d188-empty-paragraph-read.test.tsx:B3', externalEvidence: ['Rust encoding tests'],
  };
}
function rejected(value: unknown, rule: string, ctx = context) {
  const diagnostics = validateRecord(value, ctx);
  expect(diagnostics.some(line => line.includes('a-example') && line.includes(rule))).toBe(true);
}
const caret = { text: 'A', edge: 'after' };
const range = { text: 'A' };
const cell = { cell: { table: 1, row: 1, col: 1 } };
const actions = [
  { kind: 'type', at: caret, text: 'X' }, { kind: 'delete', range },
  { kind: 'toggleMark', range, mark: 'strong' }, { kind: 'clearFormat', range },
  { kind: 'setListKind', at: caret, to: 'bullet' }, { kind: 'paste', at: caret, text: 'X' },
  { kind: 'undo' }, { kind: 'insertTableRow', at: cell, side: 'above' },
  { kind: 'insertTableColumn', at: cell, side: 'left' },
  { kind: 'find', query: 'A', caseSensitive: false, wholeWord: true },
  { kind: 'replace', query: 'A', with: 'B', all: false, caseSensitive: false, wholeWord: true },
  { kind: 'modeSwitch', to: 'source' }, { kind: 'activateLink', link: range },
];
function edited(action: unknown): Record<string, any> {
  return { ...record(), actionGroup: 'edited', fidelityTag: 'semantic-roundtrip', input: 'edited/a/input.md',
    expected: { serialized: 'edited/a/expected.md' }, action };
}
const editContext = { files: { 'edited/a/input.md': 'A\n', 'edited/a/expected.md': 'AX\n' } };

describe('corpus metadata', () => {
  it('accepts immutable, semantic and limitation records with complete provenance', () => {
    expect(validateRecord(record(), context)).toEqual([]);
    expect(validateRecord({ ...record(), fidelityTag: 'semantic-roundtrip', normalizations: ['N4'] },
      { files: { ...files, [paths[0]]: 'A' } })).toEqual([]);
    expect(validateRecord({ ...record(), status: 'retired', fidelityTag: 'known-limitation',
      desired: paths[2], reason: 'Adjacent lists merge.', limitRef: 'ADR-0091 C7',
      negative: { kind: 'matchDesiredOnBaseline' } }, context)).toEqual([]);
  });
  it.each([
    ['rationale', undefined], ['rationale', ''], ['rationale', 'one\ntwo'],
    ['baselineSha', undefined], ['baselineSha', 'abc'], ['fidelityTag', 'lossless'],
    ['platform', 'linux'], ['category', 'z'], ['status', 'deleted'], ['ci', 'skip'],
    ['normalizations', ['N9']], ['normalizations', ['N4', 'N4']], ['negative', undefined],
    ['negative', { kind: 'invented' }], ['consumers', 'MIG-002'],
  ])('rejects invalid %s=%j', (field, value) => rejected({ ...record(), [field]: value }, field));
  it('accepts no guarded path when no source mutation turns the case red', () => {
    expect(validateRecord({ ...record(), guardedPaths: [] }, context)).toEqual([]);
  });
  it('requires both path and receipt in every guarded path entry', () => {
    rejected({ ...record(), guardedPaths: [{ receipt: 'MIG001-a-empty' }] }, 'guardedPaths');
    rejected({ ...record(), guardedPaths: [{ path: 'src/plugins/milkdown/empty.ts' }] }, 'guardedPaths');
  });
  it('requires serialized output and existing files', () => {
    rejected({ ...record(), expected: {} }, 'serialized');
    rejected({ ...record(), input: 'no-edit/a/missing.md' }, 'input');
    rejected({ ...record(), expected: { serialized: 'no-edit/a/missing.md' } }, 'serialized');
  });
  it.each(['desired', 'reason', 'limitRef'])('requires limitation %s', field => {
    const value: Record<string, any> = { ...record(), fidelityTag: 'known-limitation', desired: paths[2], reason: 'Merge', limitRef: 'ADR-0091 C7' };
    delete value[field];
    rejected(value, field);
  });
  it('rejects pending references and equal desired bytes', () => {
    rejected({ ...record(), fidelityTag: 'known-limitation', desired: paths[2], reason: 'Merge', limitRef: 'pending' }, 'pending');
    rejected({ ...record(), fidelityTag: 'known-limitation', desired: paths[1], reason: 'Merge', limitRef: 'D197' }, 'desired');
  });
  it('rejects incoherent immutable and no-edit semantic claims', () => {
    rejected({ ...record(), normalizations: ['N4'] }, 'normalizations');
    rejected({ ...record(), fidelityTag: 'semantic-roundtrip' }, 'normalizations');
    rejected(record(), 'immutable', { files: { ...files, [paths[1]]: 'B\n' } });
    rejected({ ...edited(actions[0]), fidelityTag: 'immutable' }, 'immutable', editContext);
    const interaction = { ...record(), actionGroup: 'interaction', input: 'interaction/a/input.md',
      expected: { serialized: 'interaction/a/expected.md' }, action: actions[0] };
    rejected(interaction, 'immutable', { files: { 'interaction/a/input.md': 'A\n', 'interaction/a/expected.md': 'A\n' } });
  });
  it.each(actions)('accepts the complete action $kind', action => {
    expect(validateRecord(edited(action), editContext)).toEqual([]);
  });
  it('pins the approved vocabulary without additions or omissions', () => {
    expect(ACTION_KINDS).toEqual(actions.map(action => action.kind));
    expect(OBSERVATION_KINDS).toEqual(['toc', 'largeDocGuard', 'find', 'pasteSafety', 'linkActivation', 'renderedMath', 'imageSources', 'selection']);
    expect(NORMALIZATION_IDS).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8']);
    expect(NEGATIVE_KINDS).toEqual(['dropText', 'alterByte', 'corruptSerialized', 'wrongObservation', 'matchDesiredOnBaseline']);
  });
  it.each(['toc', 'largeDocGuard', 'find', 'pasteSafety', 'linkActivation', 'renderedMath', 'imageSources', 'selection'])('accepts observation %s', observation => {
    expect(validateRecord({ ...record(), expected: { ...record().expected, observation: paths[3] } },
      { files: { ...files, [paths[3]]: JSON.stringify({ [observation]: observation === 'toc' || observation === 'imageSources' ? [] : observation === 'largeDocGuard' ? { action: 'allow' } : observation === 'find' ? { query: 'A', options: { caseSensitive: false, wholeWord: true }, matches: [] } : observation === 'pasteSafety' ? { forbiddenFound: [] } : observation === 'renderedMath' ? { count: 0 } : observation === 'linkActivation' ? { outcome: 'no-href', defaultPrevented: true, propagated: true, openerCalls: [] } : { text: '' } }) } })).toEqual([]);
  });
  it.each(['dropText', 'alterByte', 'corruptSerialized', 'wrongObservation', 'matchDesiredOnBaseline'])('accepts negative %s', kind => {
    const value = { ...record(), negative: { kind } };
    if (kind === 'matchDesiredOnBaseline') Object.assign(value, { fidelityTag: 'known-limitation', desired: paths[2], reason: 'Loss', limitRef: 'D197' });
    if (kind === 'wrongObservation') Object.assign(value, { expected: { ...record().expected, observation: paths[3] } });
    expect(validateRecord(value, context)).toEqual([]);
  });
  it.each(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'])('accepts approved normalization %s on edited metadata', normalization => {
    expect(validateRecord({ ...edited(actions[0]), normalizations: [normalization] }, editContext)).toEqual([]);
  });
  it.each([
    { kind: 'invented' }, { kind: 'type', at: caret }, { kind: 'type', at: { ...caret, edge: 'middle' }, text: 'X' },
    { kind: 'type', at: { text: 'A\nB', edge: 'after' }, text: 'X' },
    { kind: 'delete' }, { kind: 'toggleMark', range, mark: 'bold' }, { kind: 'clearFormat' },
    { kind: 'setListKind', at: caret, to: 'task' }, { kind: 'paste', at: caret },
    { kind: 'insertTableRow', at: cell, side: 'left' }, { kind: 'insertTableColumn', at: cell, side: 'above' },
    { kind: 'find', query: 'A', wholeWord: false }, { kind: 'replace', query: 'A', all: true },
    { kind: 'modeSwitch', to: 'preview' }, { kind: 'activateLink' },
  ])('rejects incomplete or unknown action %j', action => rejected(edited(action), 'action', editContext));
  for (const index of [0, -1, 1.5, NaN, Infinity, -Infinity]) {
    it(`rejects all invalid indices ${index}`, () => {
      rejected(edited({ kind: 'type', at: { ...caret, occurrence: index }, text: 'X' }), 'occurrence', editContext);
      for (const field of ['table', 'row', 'col']) {
        rejected(edited({ kind: 'insertTableRow', at: { cell: { ...cell.cell, [field]: index } }, side: 'above' }), field, editContext);
      }
      for (const endpoint of ['from', 'to'] as const) for (const coordinate of [0, 1]) {
        const cells = { table: 1, from: [1, 1], to: [2, 2] };
        cells[endpoint][coordinate] = index;
        rejected(edited({ kind: 'paste', at: { cells }, text: 'X' }), endpoint, editContext);
      }
    });
  }
  it('rejects reversed cell ranges and wrong directory components', () => {
    rejected(edited({ kind: 'paste', at: { cells: { table: 1, from: [2, 2], to: [1, 1] } }, text: 'X' }), 'anchor', editContext);
    rejected({ ...record(), input: 'else/a/no-edit-input.md' }, 'directory', { files: { ...files, 'else/a/no-edit-input.md': 'A\n' } });
    rejected({ ...record(), input: '../no-edit/a/input.md' }, 'path');
  });
  it('accepts empty actions only for no-edit', () => {
    expect(validateRecord(record(), context)).toEqual([]);
    rejected(edited([]), 'action', editContext);
    rejected({ ...edited([]), actionGroup: 'interaction' }, 'action', editContext);
  });
  it('rejects unknown observation, malformed identity and duplicate ids', () => {
    rejected({ ...record(), expected: { ...record().expected, observation: paths[3] } }, 'observation',
      { files: { ...files, [paths[3]]: '{"scrollAnchor":{}}' } });
    const diagnostics = validateManifest([record(), record()], context);
    expect(diagnostics.some(line => line.includes('a-example') && line.includes('duplicate'))).toBe(true);
    for (const caseId of ['a_foo', 'b-example', 'a-', 'a-UPPER']) {
      expect(validateRecord({ ...record(), caseId }, context).some(line => line.includes('caseId'))).toBe(true);
    }
  });
  it('reports unlisted files and preserves retired ids', () => {
    const value = { ...record(), status: 'retired', desired: undefined, externalEvidence: ['native evidence'] };
    expect(validateManifest([value], { files: { [paths[0]]: files[paths[0]], [paths[1]]: files[paths[1]] } })).toEqual([]);
    expect(validateManifest([value], context).some(line => line.includes('unlisted') && line.includes(paths[2]))).toBe(true);
  });
});

describe('canonical JSON and read-only validation', () => {
  it('sorts object keys recursively, preserves arrays and is idempotent', () => {
    const value = { z: [{ z: 2, a: 1 }, { kind: 'undo' }], a: { z: 0, a: 1 } };
    const expected = '{\n  "a": {\n    "a": 1,\n    "z": 0\n  },\n  "z": [\n    {\n      "a": 1,\n      "z": 2\n    },\n    {\n      "kind": "undo"\n    }\n  ]\n}\n';
    expect(canonicalJson(value)).toBe(expected);
    expect(canonicalJson(JSON.parse(expected))).toBe(expected);
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });
  it('retains all provenance, action order and original objects across repeated operations', () => {
    const value = { ...record(), status: 'retired', action: [actions[0], { ...actions[0], text: 'Y' }, actions[6]] };
    const original = JSON.stringify(value);
    const originalFiles = JSON.stringify(files);
    const one = canonicalJson(value);
    expect(canonicalJson(JSON.parse(one))).toBe(one);
    expect(JSON.parse(one)).toEqual(value);
    expect(JSON.parse(one).action.map((action: any) => action.text ?? action.kind)).toEqual(['X', 'Y', 'undo']);
    expect(validateRecord(value, context)).toEqual(validateRecord(value, context));
    expect(JSON.stringify(value)).toBe(original);
    expect(JSON.stringify(files)).toBe(originalFiles);
    expect(paths.map((_, index) => readFileSync(join(root, String(index)), 'utf8'))).toEqual(contents);
  });
});
