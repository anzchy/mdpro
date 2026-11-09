import { collectionCases } from './support/collectionCases';
import { describe, expect, it } from 'vitest';
import { compareCase } from './support/corpus/comparator.ts';
import type { CorpusAction, MountingRecord, NormalizationId, Observations } from './support/corpus/types.ts';
const caret = (text: string, edge: 'before' | 'after' = 'after', occurrence?: number) => ({ text, edge, ...(occurrence === undefined ? {} : { occurrence }) });
const type = (text: string, at = 'target', edge: 'before' | 'after' = 'after'): CorpusAction => ({ kind: 'type', at: caret(at, edge), text });
function record(action: CorpusAction | CorpusAction[] = [], patch: Partial<MountingRecord> = {}): MountingRecord {
  return { caseId: 'a-compare', category: 'a', status: 'active', actionGroup: 'edited', fidelityTag: 'semantic-roundtrip',
    input: 'edited/a/input.md', expected: { serialized: 'edited/a/expected.md' }, action, platform: 'any',
    baselineSha: 'a'.repeat(40), normalizations: [], rationale: 'Action and separator conservation.',
    guardedPaths: [{ path: 'src/plugins/milkdown/empty.ts', receipt: 'MIG001-a-empty' }], consumers: ['MIG-009a'],
    negative: { kind: 'alterByte' }, ...patch };
}
function compare(input: string, candidate: string, action: CorpusAction | CorpusAction[], patch: Partial<MountingRecord> = {}) {
  return compareCase(record(action, patch), { input, expectedSerialized: candidate }, { untouched: input, serialized: candidate });
}
function passes(input: string, candidate: string, action: CorpusAction | CorpusAction[], patch: Partial<MountingRecord> = {}) {
  expect(() => compare(input, candidate, action, patch)).not.toThrow();
}
function fails(input: string, candidate: string, action: CorpusAction | CorpusAction[], patch: Partial<MountingRecord> = {}) {
  expect(() => compare(input, candidate, action, patch)).toThrow('a-compare');
}

describe('executable fidelity contracts', () => {
  it('checks baseline serialization and untouched bytes independently', () => {
    const r = record([], { actionGroup: 'no-edit', fidelityTag: 'immutable' });
    expect(compareCase(r, { input: 'A\n', expectedSerialized: 'A\n' }, { untouched: 'A\n', serialized: 'A\n' })).toEqual({});
    expect(() => compareCase(r, { input: 'A\n', expectedSerialized: 'A\n' }, { untouched: 'A\n', serialized: 'B\n' })).toThrow('a-compare');
    expect(() => compareCase(r, { input: 'A\n', expectedSerialized: 'A\n' }, { untouched: 'B\n', serialized: 'A\n' })).toThrow('a-compare');
    fails('A\n', 'B\n', [], { actionGroup: 'no-edit', fidelityTag: 'immutable' });
    fails('A\n', 'A\n', type('X', 'A'), { fidelityTag: 'immutable' });
    fails('A\n', 'A\n', [], { actionGroup: 'no-edit', fidelityTag: 'immutable', normalizations: ['N4'] });
    fails('A\n', 'AX\n', type('X', 'A'), { fidelityTag: 'immutable', actionGroup: 'interaction' });
  });
  it.each([
    [[], false], [['N2'], false], [['N3', 'N4'], false], [['N4'], true],
  ] as [NormalizationId[], boolean][])('requires exact minimal no-edit transforms %j', (normalizations, valid) => {
    const fn = () => compare('A', 'A\n', [], { actionGroup: 'no-edit', normalizations });
    if (valid) expect(fn).not.toThrow(); else expect(fn).toThrow('a-compare');
  });
  it('rejects redundant syntactic-list N6 and unknown normalization IDs', () => {
    fails('* A\n', '* A\n', [], { actionGroup: 'no-edit', normalizations: ['N6'] });
    fails('A', 'A\n', [], { actionGroup: 'no-edit', normalizations: ['N9' as NormalizationId] });
  });
  it.each(['desired', 'reason', 'limitRef'])('requires known-limitation %s', field => {
    const r = record([], { actionGroup: 'no-edit', fidelityTag: 'known-limitation', desired: 'desired.md', reason: 'Merge', limitRef: 'ADR-0091 C7' });
    if (field !== 'desired' && field !== 'reason' && field !== 'limitRef') throw new Error('Unexpected limitation field');
    delete r[field];
    expect(() => compareCase(r, { input: 'A\n', expectedSerialized: 'E\n', desired: 'D\n' }, { untouched: 'A\n', serialized: 'E\n' })).toThrow('a-compare');
  });
  it('rejects equal desired/current and pending classification', () => {
    const r = record([], { actionGroup: 'no-edit', fidelityTag: 'known-limitation', desired: 'desired.md', reason: 'Merge', limitRef: 'ADR-0091 C7' });
    expect(() => compareCase(r, { input: 'A\n', expectedSerialized: 'E\n', desired: 'E\n' }, { untouched: 'A\n', serialized: 'E\n' })).toThrow('a-compare');
    expect(() => compareCase({ ...r, limitRef: 'pending' }, { input: 'A\n', expectedSerialized: 'E\n', desired: 'D\n' }, { untouched: 'A\n', serialized: 'E\n' })).toThrow('a-compare');
  });
});

describe('independent r2-r5 loss witnesses', () => {
  const witnesses: [string, string, CorpusAction][] = [
    ['Keep beta\n', 'Keep\n', { kind: 'toggleMark', range: { text: 'beta' }, mark: 'strong' }],
    ['```\na b\n```\n\ntarget\n', '```\nab\n```\n\ntargetX\n', type('X')],
    ['A\n\n\n\nB\n\nC\n', 'A\n\nB\n\nCX\n', type('X', 'C')],
    ['A\n\n\n\nB\n\nC\n', 'A\n\nB\n\n\n\nCX\n', type('X', 'C')],
    ['> a\n>\n>\n>\n> b\n', '> a\n>\n> b!\n', type('!', 'b')],
    ['* a\n\n\n\n  b\n', '* a\n\n  b!\n', type('!', 'b')],
    ['> * a\n>\n>\n>\n>   b\n', '> * a\n>\n>   b!\n', type('!', 'b')],
    ['* > a\n  >\n  >\n  >\n  > b\n', '* > a\n  >\n  > b!\n', type('!', 'b')],
  ];
  it.each(witnesses)('rejects loss even with baseline equality: %s -> %s', (input, output, action) => fails(input, output, action));
  it.each(collectionCases('faithful protected-container witnesses', witnesses.slice(1)))('accepts the faithful protected-container counterpart: %s damaged as %s', (input, _output, action) => {
    const anchor = action.kind === 'type' ? action.at.text : '';
    const index = input.lastIndexOf(anchor) + anchor.length;
    const output = input.slice(0, index) + (action.kind === 'type' ? action.text : '') + input.slice(index);
    passes(input, output, action);
  });
  it.each([
    ['A\n\nB\n\ntarget\n', 'A\n\n\n\nB\n\ntargetX\n'],
    ['A\n\nB\n\ntarget\n', 'B\n\nA\n\ntargetX\n'],
    ['# A\n\ntarget\n', '## A\n\ntargetX\n'],
    ['\n\nA\n\ntarget\n', 'A\n\ntargetX\n'],
    ['A\n\ntarget\n\n', 'A\n\ntargetX\n'],
    ['* A\n* B\n\ntarget\n', '* A\n\n* B\n\ntargetX\n'],
    ['    a b\n\ntarget\n', '    ab\n\ntargetX\n'],
    ['<div>a b</div>\n\ntarget\n', '<div>ab</div>\n\ntargetX\n'],
    ['`a b`\n\ntarget\n', '`ab`\n\ntargetX\n'],
    ['| A | B |\n| --- | --- |\n| C | D |\n\ntarget\n', '| A | B |\n| --- | --- |\n| C | E |\n\ntargetX\n'],
  ])('rejects untouched bytes/separator drift: %s -> %s', (input, output) => fails(input, output, type('X')));
});

describe('action-aware state transitions', () => {
  for (const mark of ['strong', 'emphasis', 'code', 'strike', 'highlight', 'underline'] as const) {
    it(`conserves target text for ${mark}`, () => {
      const wrapped = mark === 'strong' ? '**beta**' : mark === 'emphasis' ? '*beta*' : mark === 'code' ? '`beta`' : mark === 'strike' ? '~~beta~~' : mark === 'highlight' ? '==beta==' : '<u>beta</u>';
      const action: CorpusAction = { kind: 'toggleMark', range: { text: 'beta' }, mark };
      passes('Keep beta\n', `Keep ${wrapped}\n`, action);
      passes(`Keep ${wrapped}\n`, 'Keep beta\n', action);
      fails('Keep beta\n', 'Keep\n', action);
      fails('Keep beta\n', 'Keep beta extra\n', action);
    });
  }
  it('allows markup variation in a touched paragraph and keeps text', () => {
    passes('Keep **beta**\n', 'Keep beta\n', { kind: 'clearFormat', range: { text: 'beta' } });
    passes('# target\n', '## targetX\n', type('X'));
    fails('Keep **beta**\n', 'Keep\n', { kind: 'clearFormat', range: { text: 'beta' } });
  });
  it('models list conversion through every item without freeing internal separators or subtrees', () => {
    const action: CorpusAction = { kind: 'setListKind', at: caret('beta'), to: 'ordered' };
    const input = '* Keep\n\n* beta\n\n\n\n  tail\n  * nested\n';
    passes(input, '1. Keep\n\n2. beta\n\n\n\n   tail\n   * nested\n', action);
    fails(input, '1. Keep\n\n2. beta\n\n   tail\n   * nested\n', action);
    fails(input, '1. Keep\n\n2. beta\n\n\n\n   tail\n   * changed\n', action);
    fails(input, '1. Keep\n\n2.\n\n\n\n   tail\n   * nested\n', action);
    passes('1. Keep\n2. beta\n', '* Keep\n* beta\n', { ...action, to: 'bullet' });
  });
  it.each<CorpusAction>([
    { kind: 'find', query: 'beta', caseSensitive: true, wholeWord: true },
    { kind: 'modeSwitch', to: 'source' }, { kind: 'activateLink', link: { text: 'beta' } },
  ])('non-destructive $kind preserves text', action => {
    passes('Keep beta\n', 'Keep beta\n', action);
    fails('Keep beta\n', 'Keep\n', action);
  });
  it('types at either caret edge and respects exact occurrence across marks', () => {
    passes('Keep beta\n', 'Keep Xbeta\n', type('X', 'beta', 'before'));
    passes('Keep beta\n', 'Keep betaX\n', type('X', 'beta'));
    passes('beta **beta**\n', 'beta **beta**X\n', { kind: 'type', at: caret('beta', 'after', 2), text: 'X' });
    passes('be**ta**\n', 'be**ta**X\n', type('X', 'beta'));
    fails('Keep beta\n', 'Keep Xbeta\n', type('X', 'beta'));
  });
  it('deletes only named selection, including a cross-block join', () => {
    passes('Keep beta\n', 'Keep \n', { kind: 'delete', range: { text: 'beta' } });
    fails('Keep beta\n', '\n', { kind: 'delete', range: { text: 'beta' } });
    passes('left a\n\n\n\nb right\n\nOuter\n', 'left  right\n\nOuter\n', { kind: 'delete', range: { text: 'a\n\nb' } });
    fails('left a\n\n\n\nb right\n\nOuter\n', 'left  right\n\n\n\nOuter\n', { kind: 'delete', range: { text: 'a\n\nb' } });
  });
  for (const caseSensitive of [false, true]) for (const wholeWord of [false, true]) for (const all of [false, true]) {
    it(`models replace case=${caseSensitive} word=${wholeWord} all=${all}`, () => {
      const input = 'beta Beta betamax beta\n';
      const output = !all ? 'X Beta betamax beta\n' : caseSensitive ? wholeWord ? 'X Beta betamax X\n' : 'X Beta Xmax X\n' : wholeWord ? 'X X betamax X\n' : 'X X Xmax X\n';
      const action: CorpusAction = { kind: 'replace', query: 'beta', with: 'X', all, caseSensitive, wholeWord };
      passes(input, output, action);
      fails(input, 'X\n', action);
    });
  }
  it('preserves literal whitespace in targeted code spans and fenced/indented code', () => {
    const action = type('X', 'a b');
    passes('`a b`\n', '`a bX`\n', action); fails('`a b`\n', '`abX`\n', action);
    passes('```txt\na b\n```\n', '```txt\na bX\n```\n', action);
    fails('```txt\na b\n```\n', '```txt\nabX\n```\n', action);
    passes('    a b\n', '    a bX\n', action); fails('    a b\n', '    abX\n', action);
  });
  it('models ordered actions and undo by the preceding state', () => {
    const actions: CorpusAction[] = [type('X', 'A'), type('Y', 'AX'), { kind: 'undo' }, { kind: 'undo' }];
    passes('A\n', 'A\n', actions);
    passes('A\n', 'AX\n', actions.slice(0, 3));
    fails('A\n', 'AXY\n', actions.slice(0, 3));
    passes('A\n', 'AXY\n', actions.slice(0, 2));
  });
  it('rejects missing/out-of-range or partial-grapheme anchors', () => {
    fails('A\n', 'AX\n', type('X', 'missing'));
    fails('A\n', 'AX\n', { kind: 'type', at: caret('A', 'after', 2), text: 'X' });
    fails('👨‍👩‍👧‍👦\n', '👨X‍👩‍👧‍👦\n', type('X', '👨'));
    passes('👨‍👩‍👧‍👦\n', '👨‍👩‍👧‍👦X\n', type('X', '👨‍👩‍👧‍👦'));
  });
});

describe('splits, joins and pasted block structures', () => {
  it.each([
    ['A\n', 'A\n\nX\n', type('\nX', 'A')],
    ['A\n', 'A\n\n\n\nX\n', type('\n\nX', 'A')],
    ['> A\n', '> A\n>\n> X\n', type('\nX', 'A')],
    ['* A\n* B\n', '* A\n* X\n* B\n', type('\nX', 'A')],
    ['* A\n\n* B\n', '* A\n\n* X\n\n* B\n', type('\nX', 'A')],
    ['```\nA\n```\n', '```\nA\nX\n```\n', type('\nX', 'A')],
    ['A\n', 'A\n', type('\n', 'A')],
  ] as [string, string, CorpusAction][])('accepts modeled split: %s -> %s', (input, output, action) => {
    passes(input, output, action);
    if (input !== output) fails(input, output.replace('X', 'Y'), action);
  });
  it('rejects missing/added/moved split separators and container-kind changes', () => {
    fails('A\n', 'A\n\nX\n', type('\n\nX', 'A'));
    fails('A\n', 'A\n\n\n\nX\n', type('\nX', 'A'));
    fails('> A\n', 'A\n\nX\n', type('\nX', 'A'));
    fails('> A\n', 'A!\n', type('!', 'A'));
    fails('* A\n', '* A\n* X\n', type('\n\nX', 'A'));
  });
  it.each([
    { kind: 'paste', at: caret('X'), text: 'a\n\n\n\nb' },
    { kind: 'paste', at: caret('X'), html: '<p>a</p><p></p><p>b</p>' },
  ] as CorpusAction[])('models multiblock %j with its own inner separators', action => {
    const input = 'Keep\n\nXY\n\nOuter\n';
    const output = 'Keep\n\nX\n\na\n\n\n\nb\n\nY\n\nOuter\n';
    passes(input, output, action);
    fails(input, output.replace('a\n\n\n\nb', 'a\n\nb'), action);
    fails(input, output.replace('Y\n\nOuter', 'Y\n\n\n\nOuter'), action);
  });
  it('models single-block text and HTML paste without freeing target text', () => {
    passes('Keep beta\n', 'Keep betaX\n', { kind: 'paste', at: caret('beta'), text: 'X' });
    passes('Keep beta\n', 'Keep beta**X**\n', { kind: 'paste', at: caret('beta'), html: '<strong>X</strong>' });
    fails('Keep beta\n', 'X\n', { kind: 'paste', at: caret('beta'), text: 'X' });
  });
});

describe('alternate engine rules and immutable reports', () => {
  const limit = record([], { actionGroup: 'no-edit', fidelityTag: 'known-limitation', desired: 'desired.md', reason: 'Merge', limitRef: 'ADR-0091 C7' });
  const files = { input: 'A\n', expectedSerialized: 'E\n', desired: 'D\n', expectedObservation: { selection: { text: '' } } as Observations };
  it('pins baseline E, allows either alternate side and names the improvement', () => {
    const actual = (serialized: string) => ({ untouched: 'A\n', serialized, observation: { selection: { text: '' } } });
    expect(compareCase(limit, files, actual('E\n'))).toEqual({});
    expect(() => compareCase(limit, files, actual('D\n'))).toThrow('a-compare');
    expect(compareCase(limit, files, actual('E\n'), 'alternate')).toEqual({});
    expect(compareCase(limit, files, actual('D\n'), 'alternate')).toEqual({ improvement: true, caseId: 'a-compare' });
    expect(() => compareCase(limit, files, actual('other\n'), 'alternate')).toThrow('a-compare');
    const before = JSON.stringify([limit, files]);
    expect(compareCase(limit, files, actual('D\n'), 'alternate')).toEqual(compareCase(limit, files, actual('D\n'), 'alternate'));
    expect(JSON.stringify([limit, files])).toBe(before);
  });
  it('reports actual normalization-only alternate differences and rejects unrelated drift', () => {
    const r = record([], { actionGroup: 'no-edit', normalizations: ['N1'] });
    const data = { input: 'a  \nb\n', expectedSerialized: 'a\\\nb\n' };
    expect(compareCase(r, data, { untouched: data.input, serialized: data.input }, 'alternate')).toEqual({ normalizations: ['N1'], caseId: 'a-compare' });
    expect(() => compareCase(r, data, { untouched: data.input, serialized: 'a\\\nc\n' }, 'alternate')).toThrow('a-compare');
  });
  it('checks exact observations even when bytes or desired match', () => {
    expect(() => compareCase(limit, files, { untouched: files.input, serialized: files.desired, observation: { selection: { text: 'wrong' } } }, 'alternate')).toThrow('a-compare');
    expect(() => compareCase(limit, files, { untouched: files.input, serialized: files.expectedSerialized }, 'milkdown')).toThrow('a-compare');
  });
});

it('compares observations structurally regardless of object key insertion order', () => {
  const r = record([], { actionGroup: 'no-edit', fidelityTag: 'immutable' });
  const expectedObservation = { find: { query: 'A', options: { wholeWord: true, caseSensitive: false }, matches: [{ text: 'A', block: 1, occurrence: 1 }] }, selection: { text: '' } };
  const observation = { selection: { text: '' }, find: { options: { caseSensitive: false, wholeWord: true }, matches: [{ occurrence: 1, block: 1, text: 'A' }], query: 'A' } };
  expect(compareCase(r, { input: 'A\n', expectedSerialized: 'A\n', expectedObservation }, { untouched: 'A\n', serialized: 'A\n', observation })).toEqual({});
});
it.each([
  '<textarea>\na b\n\nc d\n</textarea>', '<!--\na b\n\nc d\n-->', '<![CDATA[\na b\n\nc d\n]]>',
])('protects complete HTML literal block %s while a different paragraph changes', literal => {
  passes(literal + '\n\ntarget\n', literal + '\n\ntargetX\n', type('X'));
  fails(literal + '\n\ntarget\n', literal.replace('a b', 'ab') + '\n\ntargetX\n', type('X'));
});
