// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { collectionCases } from './support/collectionCases';
import { applyNormalizations, htmlText, normalize } from './support/corpus/normalizations.ts';
import type { NormalizationId } from './support/corpus/types.ts';

const examples: [NormalizationId, string, string][] = [
  ['N1', 'a  \nb\n', 'a\\\nb\n'],
  ['N1', 'a\\\nb\n', 'a\\\nb\n'],
  ['N1', '> a  \n> b\n', '> a\\\n> b\n'],
  ['N2', 'a\n\nb\n', 'a\n\nb\n'],
  ['N2', 'a\n\n\nb\n', 'a\n\nb\n'],
  ['N2', 'a\n\n\n\nb\n', 'a\n\n\n\nb\n'],
  ['N2', 'a\n\n\n\n\nb\n', 'a\n\n\n\nb\n'],
  ['N2', 'a\n\n\n\n\n\nb\n', 'a\n\n\n\n\n\nb\n'],
  ['N2', 'a\n  \n\t\n \nb\n', 'a\n\n\n\nb\n'],
  ['N2', '> a\n>\n>\n> b\n', '> a\n>\n> b\n'],
  ['N2', '- a\n  \n  \n  b\n', '- a\n\n  b\n'],
  ['N3', '\n\nA\n\n\n', 'A\n'],
  ['N3', '\n \n\t\n', ''],
  ['N3', '>\n> a\n>\n>\n', '> a\n'],
  ['N3', '- a\n  \n  \n', '- a\n'],
  ['N4', 'A', 'A\n'],
  ['N4', 'A\n', 'A\n'],
  ['N4', '', '\n'],
  ['N5', 'a\n\n<br />\n\nb\n', 'a\n\n\n\nb\n'],
  ['N5', 'a\n\n<BR>\n\nb\n', 'a\n\n\n\nb\n'],
  ['N5', 'a<br />b\n', 'a<br />b\n'],
  ['N6', '- a\n  * b\n  + c\n\n1) d\n2) e\n\n1. f\n', '- a\n  * b\n  + c\n\n1) d\n2) e\n\n1. f\n'],
  ['N7', '|a|long|\n|---|:---:|\n|b|c|\n', '| a | long |\n| - | :--: |\n| b |   c  |\n'],
  ['N7', '| a | b |\n| ---: | :--- |\n| c | d |\n', '|  a | b  |\n| -: | :- |\n|  c | d  |\n'],
  ['N7', '| a\\|b | c |\n|---|---|\n| x | y |\n', '| a\\|b | c |\n| ---- | - |\n| x    | y |\n'],
  ['N8', '| a | b |\n| - | - |\n| c | d | e |\n', '| a | b |   |\n| - | - | - |\n| c | d | e |\n'],
  ['N8', '| a | b | c |\n| - | - | - |\n| d |\n', '| a | b | c |\n| - | - | - |\n| d |   |   |\n'],
];

describe('approved reference normalizations', () => {
  it.each(examples)('%s maps %j to independently specified bytes', (id, input, expected) => {
    expect(normalize(id, input)).toBe(expected);
    expect(normalize(id, normalize(id, input))).toBe(expected);
  });
  it.each(['N1', 'N2', 'N5', 'N7', 'N8'] as const)('%s preserves protected code and HTML literal bytes', id => {
    const protectedText = '```md\na  \nb\n\n\n\n\nc\n<br />\n|x|\n|---|\n```\n\n    a  \n    b\n\n<div>\na  \n\n\n<br />\n</div>\n';
    expect(normalize(id, protectedText)).toBe(protectedText);
  });
  it('keeps inline-code whitespace and literal HTML attributes', () => {
    const input = '`a  \nb` and <span title="x  y">z</span>\n';
    expect(normalize('N1', input)).toBe(input);
  });
  it('normalizes nested quote/list levels without destroying container text', () => {
    const input = '> - a\n>   \n>   \n>   b\n';
    expect(normalize('N2', input)).toBe('> - a\n>\n>   b\n');
    expect(normalize('N6', input)).toBe(input);
  });
  it('applies in list order and remains independent of earlier calls', () => {
    const input = '\n\nA\n\n\n\n\nB';
    expect(applyNormalizations(input, ['N2', 'N3', 'N4'])).toBe('A\n\n\n\nB\n');
    expect(applyNormalizations(input, [])).toBe(input);
    expect(applyNormalizations(input, ['N2', 'N3', 'N4'])).toBe('A\n\n\n\nB\n');
  });
  it.each(collectionCases('N2 newline-run domain', Array.from({ length: 12 }, (_, index) => index + 2)))('N2 conserves sibling text at newline-run %i', count => {
    const input = `left${'\n'.repeat(count)}right\n`;
    const output = normalize('N2', input);
    expect(output).toBe(`left${'\n'.repeat(2 * Math.floor(count / 2))}right\n`);
    expect(normalize('N2', output)).toBe(output);
  });
  it('normalizes a table nested inside a quote without flattening the quote', () => {
    expect(normalize('N7', '> |a|b|\n> |---|---|\n> |c|d|\n')).toBe('> | a | b |\n> | - | - |\n> | c | d |\n');
  });
});

describe('reference HTML tag stripping for action text', () => {
  it.each([
    ['<strong>A</strong> &amp; <em>B</em>', 'A & B'],
    ['<p>a</p><p></p><p>b</p>', 'a\n\n\n\nb'],
    ['<p>a</p><div>b<br>c</div>', 'a\n\nb\nc'],
    ['<p>&lt;x&gt; &#x1f600; &#65; &nbsp; B</p>', '<x> 😀 A \u00a0 B'],
    ['<pre>a  b\n c</pre>', 'a  b\n c'],
  ])('strips %s to visible text and exact block separators', (input, expected) => {
    expect(htmlText(input)).toBe(expected);
  });
});

describe('normalization conservation across literal/container boundaries', () => {
  it.each([
    'a\n\n\n\n```\nx\n```\n\n\n\nb\n',
    'a\n\n\n\n> x\n\n\n\nb\n',
    'a\n\n\n\n- x\n\n\n\nb\n',
    'a\n\n\n\n<div>x</div>\n\n\n\nb\n',
  ])('N3 strips document edges only, retaining internal gaps in %j', input => {
    expect(normalize('N3', input)).toBe(input);
    expect(normalize('N3', '\n\n' + input + '\n\n')).toBe(input);
  });
  it('N2 counts gaps beside fenced literals at the containing level', () => {
    expect(normalize('N2', 'a\n\n\n```\nx\n```\n\n\nb\n')).toBe('a\n\n```\nx\n```\n\nb\n');
  });
  it('N5 rewrites an edge legacy paragraph without inventing its neighboring gaps', () => {
    expect(normalize('N5', '<br />\n\na\n\n<br />\n')).toBe('\n\na\n\n\n');
  });
});

it('table padding measures original inline-code bytes and keeps literal whitespace', () => {
  expect(normalize('N7', '| `a  b` | c |\n|---|---|\n| d | e |\n')).toBe('| `a  b` | c |\n| ------ | - |\n| d      | e |\n');
  expect(normalize('N8', '| `a  b` | c |\n|---|---|\n| d |\n')).toBe('| `a  b` | c |\n| ------ | - |\n| d      |   |\n');
});

it('reference transforms do not invent quote prefix or list-blank spelling changes', () => {
  const input = '>a\n> \n>b\n\n- c\n  \n  d\n';
  for (const id of ['N1', 'N2', 'N3', 'N5', 'N7', 'N8'] as const) expect(normalize(id, input)).toBe(input);
});

it.each([
  ['<textarea>', '</textarea>'],
  ['<!--', '-->'],
  ['<?instruction', '?>'],
  ['<![CDATA[', ']]>'],
])('protects special raw HTML block %s through its closing marker', (open, close) => {
  const input = `${open}\na  \nb\n\n\n<br />\n\n|a|b|\n|---|---|\n|c|d|\n${close}\n`;
  for (const id of ['N1', 'N2', 'N3', 'N5', 'N7', 'N8'] as const) expect(normalize(id, input)).toBe(input);
});
