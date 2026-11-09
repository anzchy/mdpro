Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
const { afterEach, expect, it } = await import('vitest');
const { FakeTauriBoundary } = await import('./support/corpus/fakeBoundary.ts');
const { installCorpusBoundary } = await import('./support/corpus/boundaryMocks.ts');
const boundary = new FakeTauriBoundary();
installCorpusBoundary(boundary);
const { createMilkdownDriver } = await import('./support/corpus/milkdownDriver.tsx');
const driver = createMilkdownDriver(boundary, { caseId: 'a-cell-selection' });
afterEach(async () => { await driver.cleanup(); });
it('observes every selected cell in reading order after an actual paste refusal', async () => {
  await driver.mount('| A | B |\n| - | - |\n| C | D |\n', 'any');
  const before = await driver.serialize();
  await driver.runAction({ kind: 'paste', at: { cells: { table: 1, from: [1, 1], to: [2, 2] } },
    html: '<p>before</p><table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table><p>after</p>' });
  expect(await driver.serialize()).toBe(before);
  expect(await driver.observe('selection')).toEqual({ text: 'A\nB\nC\nD' });
});

export {};
