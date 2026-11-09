/** @vitest-environment-options { "url": "tauri://localhost/" } */
Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
const { afterEach, beforeEach, expect, it } = await import('vitest');
const { FakeTauriBoundary } = await import('./support/corpus/fakeBoundary.ts');
const { installCorpusBoundary } = await import('./support/corpus/boundaryMocks.ts');
const boundary = new FakeTauriBoundary();
installCorpusBoundary(boundary);
const { createMilkdownDriver } = await import('./support/corpus/milkdownDriver.tsx');
let driver = createMilkdownDriver(boundary, { caseId: 'j-links' });
beforeEach(() => { installCorpusBoundary(boundary); driver = createMilkdownDriver(boundary, { caseId: 'j-links' }); });
afterEach(async () => { document.head.querySelectorAll('base').forEach(base => base.remove()); await driver.cleanup(); });
async function mount(input: string, serialized = input) {
  expect(location.protocol).toBe('tauri:');
  await driver.mount(input, 'any');
  expect(boundary.writeLog).toEqual([]);
  expect(await driver.untouched()).toBe(input);
  expect(await driver.serialize()).toBe(serialized);
}
const refused = (reason: 'scheme' | 'resolved-mismatch') => ({ outcome: 'refused', reason, defaultPrevented: true, propagated: false, openerCalls: [] });
it.each([
  ['javascript', '[target](javascript:bad)\n'], ['data', '[target](data:text/html,bad)\n'],
  ['file', '[target](file:///tmp/a)\n'], ['protocol relative', '[target](//evil.test/x)\n'],
] as const)('observes real %s scheme refusal without opening or changing bytes', async (_name, input) => {
  await mount(input);
  await driver.runAction({ kind: 'activateLink', link: { text: 'target' } });
  expect(await driver.observe('linkActivation')).toEqual(refused('scheme'));
  expect(boundary.events.filter(event => event.event === 'editor.milkdown.link.blocked')).toMatchObject([{ context: { reason: 'scheme' } }]);
  expect(await driver.serialize()).toBe(input);
});
it('observes backslash authority refusal at the real guard from the live href', async () => {
  const input = '[target](./doc.md)\n';
  await mount(input);
  document.querySelector('a')!.setAttribute('href', '\\\\evil.test/x');
  await driver.runAction({ kind: 'activateLink', link: { text: 'target' } });
  expect(await driver.observe('linkActivation')).toEqual(refused('scheme'));
  expect(await driver.serialize()).toBe(input);
});
it('observes resolved mismatch through a real hostile base without reclassifying raw URLs', async () => {
  const input = '[target](./doc.md)\n';
  await mount(input);
  const base = document.createElement('base'); base.href = 'customscheme://evil/'; document.head.appendChild(base);
  expect(document.querySelector('a')!.href).toBe('customscheme://evil/doc.md');
  await driver.runAction({ kind: 'activateLink', link: { text: 'target' } });
  expect(await driver.observe('linkActivation')).toEqual(refused('resolved-mismatch'));
  expect(await driver.serialize()).toBe(input);
});
it.each(['./doc.md', '#part'] as const)('observes same-app %s cancellation and ancestor bubbling', async href => {
  const input = `[target](${href})\n`;
  await mount(input);
  await driver.runAction({ kind: 'activateLink', link: { text: 'target' } });
  expect(await driver.observe('linkActivation')).toEqual({ outcome: 'same-app', defaultPrevented: true, propagated: true, openerCalls: [] });
  expect(boundary.events.filter(event => event.event === 'editor.milkdown.link.in_document')).toHaveLength(1);
  expect(await driver.serialize()).toBe(input);
});
it('observes no-href as a cancelled bubbling click without logs or opener', async () => {
  const input = '[target](./doc.md)\n';
  await mount(input); document.querySelector('a')!.removeAttribute('href');
  await driver.runAction({ kind: 'activateLink', link: { text: 'target' } });
  expect(await driver.observe('linkActivation')).toEqual({ outcome: 'no-href', defaultPrevented: true, propagated: true, openerCalls: [] });
  expect(boundary.events.filter(event => event.event.startsWith('editor.milkdown.link.'))).toEqual([]);
  expect(await driver.serialize()).toBe(input);
});
it('awaits exactly one external opener per click and resets observations on fresh mount', async () => {
  const input = '[target](https://example.test/x)\n';
  await mount(input);
  for (let count = 1; count <= 2; count++) {
    await driver.runAction({ kind: 'activateLink', link: { text: 'target' } });
    expect(await driver.observe('linkActivation')).toEqual({ outcome: 'external', defaultPrevented: true, propagated: true, openerCalls: ['https://example.test/x'] });
    expect(boundary.openerCalls).toEqual(Array(count).fill('https://example.test/x'));
    expect(await driver.serialize()).toBe(input);
  }
  await mount('[target](#part)\n');
  await expect(driver.observe('linkActivation')).rejects.toThrow(/j-links: no link activation/);
  await driver.runAction({ kind: 'activateLink', link: { text: 'target' } });
  expect(await driver.observe('linkActivation')).toEqual({ outcome: 'same-app', defaultPrevented: true, propagated: true, openerCalls: [] });
  expect(boundary.openerCalls).toEqual([]);
  expect(await driver.serialize()).toBe('[target](#part)\n');
});
it('resolves the requested occurrence within marked link text', async () => {
  const input = '**[target](./first.md)** [target](https://example.test/second)\n';
  await mount(input);
  await driver.runAction({ kind: 'activateLink', link: { text: 'target', occurrence: 2 } });
  expect(await driver.observe('linkActivation')).toEqual({ outcome: 'external', defaultPrevented: true, propagated: true, openerCalls: ['https://example.test/second'] });
  expect(await driver.serialize()).toBe(input);
});
it('rejects a rendered text anchor outside a link before any click effects', async () => {
  const input = 'plain [target](./doc.md)\n';
  await mount(input);
  await expect(driver.runAction({ kind: 'activateLink', link: { text: 'plain' } })).rejects.toThrow(/j-links:.*link anchor/);
  expect(boundary.openerCalls).toEqual([]);
  expect(boundary.events.filter(event => event.event.startsWith('editor.milkdown.link.'))).toEqual([]);
  expect(await driver.serialize()).toBe(input);
});

export {};
