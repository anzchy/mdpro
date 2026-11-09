Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
const { afterEach, expect, it } = await import('vitest');
const { FakeTauriBoundary } = await import('./support/corpus/fakeBoundary.ts');
const { installCorpusBoundary } = await import('./support/corpus/boundaryMocks.ts');
const boundary = new FakeTauriBoundary();
installCorpusBoundary(boundary);
const { createMilkdownDriver } = await import('./support/corpus/milkdownDriver.tsx');
const { useToastStore } = await import('../src/stores/toastStore');
const { useLinkInsertStore } = await import('../src/stores/linkInsertStore');
const { useTableInsertStore } = await import('../src/stores/tableInsertStore');
const driver = createMilkdownDriver(boundary, { caseId: 'a-cleanup' });
afterEach(async () => { await driver.cleanup(); });
it('clears pending notification work when a case is cleaned up', async () => {
  await driver.mount('Old\n', 'any');
  useToastStore.getState().showToast('Rejected old paste', 60000);
  await driver.cleanup();
  expect(useToastStore.getState().message).toBeNull();
  await driver.mount('Fresh\n', 'any');
  expect(useToastStore.getState().message).toBeNull();
  expect(await driver.serialize()).toBe('Fresh\n');
});
it('discards deferred link and table insertion requests before another document mounts', async () => {
  await driver.mount('Old\n', 'any');
  useLinkInsertStore.getState().setPendingCallback(() => { throw new Error('stale link callback'); }, 'source');
  useTableInsertStore.getState().requestInsert(() => { throw new Error('stale table callback'); });
  await driver.cleanup();
  await driver.mount('Fresh\n', 'any');
  expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
  expect(useLinkInsertStore.getState().mode).toBe('wysiwyg');
  expect(useTableInsertStore.getState().pendingCallback).toBeNull();
  expect(await driver.serialize()).toBe('Fresh\n');
});

export {};
