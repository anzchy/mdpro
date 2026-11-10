import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { validateKnownLimitations } from './helpers/knownLimitationsRegistry';

const directory = resolve('tests/fixtures/state-safety/known-limitations');

it('rejects pending references and malformed records', () => {
  const valid = { id: 'a-KL1', clause: 'a-C4', current: 'today', desired: 'guarantee', reason: 'defect', ref: '#749' };
  expect(validateKnownLimitations('a', [valid])).toEqual([]);
  expect(validateKnownLimitations('a', [{ ...valid, ref: 'pending' }])).toContain('a-KL1: ref');
  expect(validateKnownLimitations('a', [{ ...valid, current: '' }])).toContain('a-KL1: current');
  expect(validateKnownLimitations('a', [{ ...valid, clause: 'b-C1' }])).toContain('a-KL1: clause');
  expect(validateKnownLimitations('a', [{ ...valid, id: 'b-KL1' }])).toContain('b-KL1: id');
  expect(validateKnownLimitations('a', [{ ...valid, strictModeOnly: 'yes' }])).toContain('a-KL1: strictModeOnly');
  expect(validateKnownLimitations('a', [{ ...valid, observable: 'no' }])).toContain('a-KL1: observable');
  expect(validateKnownLimitations('a', {})).toContain('registry: array');
});

it('validates every row registry file', () => {
  const files = readdirSync(directory).filter(name => name.endsWith('.json'));
  expect(files).toContain('a.json');
  for (const file of files) {
    const row = file.slice(0, -5);
    const data = JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as unknown;
    expect(validateKnownLimitations(row, data)).toEqual([]);
  }
});
