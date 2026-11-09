Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
const { afterEach, beforeEach, expect, it } = await import('vitest');
const { FakeTauriBoundary } = await import('./support/corpus/fakeBoundary.ts');
const { installCorpusBoundary } = await import('./support/corpus/boundaryMocks.ts');
const boundary = new FakeTauriBoundary();
installCorpusBoundary(boundary);
const { createMilkdownDriver } = await import('./support/corpus/milkdownDriver.tsx');
let driver = createMilkdownDriver(boundary, { caseId: 'a-driver-lifecycle' });
beforeEach(() => {
  boundary.reset(); installCorpusBoundary(boundary);
  driver = createMilkdownDriver(boundary, { caseId: 'a-driver-lifecycle' });
});
afterEach(async () => { await driver.cleanup(); });
it.each([
  ['missing trailing newline', 'A'], ['edge blanks', '\n\nA\n\n\n'],
  ['hard break spelling', 'a  \nb\n'], ['empty paragraph', 'A\n\n\n\nB\n'],
  ['table spelling', '|a|b|\n|-|-|\n|c|d|\n'],
])('retains untouched bytes through real mode switches and save: %s', async (_name, input) => {
  await driver.mount(input, 'any');
  expect(boundary.writeLog).toEqual([]);
  expect(await driver.untouched()).toBe(input);
  const saves = boundary.writeLog.filter(write => write.command === 'save_file');
  expect(saves).toHaveLength(1);
  expect(saves[0].content).toBe(input);
  expect(saves[0].bytes).toEqual(Array.from(new TextEncoder().encode(input)));
});
it('serializes the real normalized model independently of untouched original bytes', async () => {
  await driver.mount('A', 'any');
  expect(await driver.serialize()).toBe('A\n');
  expect(boundary.writeLog).toEqual([]);
  expect(await driver.untouched()).toBe('A');
});
it('unmounts WYSIWYG for a real Source view and remounts WYSIWYG on return', async () => {
  await driver.mount('A\n', 'any');
  expect(document.querySelector('.ProseMirror')).not.toBeNull();
  await driver.runAction({ kind: 'modeSwitch', to: 'source' });
  expect(document.querySelector('.ProseMirror')).toBeNull();
  expect(document.querySelector('.cm-editor')).not.toBeNull();
  await driver.runAction({ kind: 'modeSwitch', to: 'wysiwyg' });
  expect(document.querySelector('.cm-editor')).toBeNull();
  expect(document.querySelector('.ProseMirror')).not.toBeNull();
  expect(await driver.serialize()).toBe('A\n');
});
it('cleanup cancels old view work and a fresh mount has no stale DOM or boundary effects', async () => {
  await driver.mount('Old\n', 'any');
  await driver.cleanup();
  expect(document.querySelector('.ProseMirror')).toBeNull();
  await driver.mount('Fresh\n', 'any');
  expect(await driver.serialize()).toBe('Fresh\n');
  expect(boundary.writeLog).toEqual([]);
  expect(boundary.openerCalls).toEqual([]);
  expect(await driver.observe('selection')).toEqual({ text: '' });
});

export {};
