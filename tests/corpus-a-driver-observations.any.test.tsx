Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
const { afterEach, beforeEach, expect, it } = await import('vitest');
const { act } = await import('@testing-library/react');
const { FakeTauriBoundary } = await import('./support/corpus/fakeBoundary.ts');
const { installCorpusBoundary } = await import('./support/corpus/boundaryMocks.ts');
const boundary = new FakeTauriBoundary();
installCorpusBoundary(boundary);
const { createMilkdownDriver } = await import('./support/corpus/milkdownDriver.tsx');
const { scanPasteSafety } = await import('./support/corpus/driverObservations.ts');
const { getFindState, openFind, setFindQuery, setFindOptions } = await import('../src/plugins/milkdown/find/findPlugin');
const { useMilkdownEditorStore } = await import('../src/stores/milkdownEditorStore');
const { editorViewCtx } = await import('@milkdown/kit/core');
let driver = createMilkdownDriver(boundary, { caseId: 'a-driver-observations' });
beforeEach(() => { installCorpusBoundary(boundary); driver = createMilkdownDriver(boundary, { caseId: 'a-driver-observations' }); });
afterEach(async () => { await driver.cleanup(); });
it.each([
  [false, false, [{ text: 'Cat', occurrence: 1, block: 1 }, { text: 'cat', occurrence: 2, block: 1 }, { text: 'cat', occurrence: 3, block: 1 }, { text: 'cat', occurrence: 4, block: 3 }]],
  [true, false, [{ text: 'cat', occurrence: 1, block: 1 }, { text: 'cat', occurrence: 2, block: 1 }, { text: 'cat', occurrence: 3, block: 3 }]],
  [false, true, [{ text: 'Cat', occurrence: 1, block: 1 }, { text: 'cat', occurrence: 2, block: 1 }, { text: 'cat', occurrence: 3, block: 3 }]],
  [true, true, [{ text: 'cat', occurrence: 1, block: 1 }, { text: 'cat', occurrence: 2, block: 3 }]],
])('reports complete find matches for caseSensitive=%s wholeWord=%s', async (caseSensitive, wholeWord, matches) => {
  await driver.mount('Cat cat cats `cat`\n\n```\ncat\n```\n\ncat\n', 'any');
  const editor = useMilkdownEditorStore.getState().getEditor() as import('@milkdown/kit/core').Editor;
  await act(async () => { editor.action(ctx => { const view = ctx.get(editorViewCtx); openFind(view, false); setFindQuery(view, 'cat'); setFindOptions(view, { caseSensitive, wholeWord }); }); });
  expect(await driver.observe('find')).toEqual({ query: 'cat', options: { caseSensitive, wholeWord }, matches });
  expect(editor.action(ctx => getFindState(ctx.get(editorViewCtx).state).query)).toBe('cat');
});
it('reports absent rendered math while preserving inline and block math source', async () => {
  const input = '$x$\n\n$$\ny = x\n$$\n';
  await driver.mount(input, 'any');
  expect(await driver.observe('renderedMath')).toEqual({ count: 0 });
  expect(await driver.serialize()).toContain('$x$');
  expect(await driver.serialize()).toContain('y = x');
});
it('reads local, absolute and remote image resolution from the rendered DOM', async () => {
  driver = createMilkdownDriver(boundary, { caseId: 'a-images', documentPath: '/docs/note.md' });
  await driver.mount('![a](./图片.png)\n\n![b](/tmp/a.png)\n\n![c](https://example.test/a.png)\n', 'any');
  expect(await driver.observe('imageSources')).toEqual([
    { markdownSrc: './图片.png', resolvedKind: 'asset' }, { markdownSrc: '/tmp/a.png', resolvedKind: 'asset' },
    { markdownSrc: 'https://example.test/a.png', resolvedKind: 'url' },
  ]);
  expect(document.querySelector('img')?.getAttribute('src')).toBe('asset://localhost/%2Fdocs%2F%E5%9B%BE%E7%89%87.png');
});
it('keeps an unresolved relative image unresolved after pristine Save As characterization', async () => {
  driver = createMilkdownDriver(boundary, { caseId: 'a-unsaved-images', documentPath: null });
  const input = '![a](./missing.png)\n';
  await driver.mount(input, 'any');
  expect(await driver.untouched()).toBe(input);
  expect(boundary.writeLog.filter(write => write.command === 'save_file_dialog')).toHaveLength(1);
  expect(await driver.observe('imageSources')).toEqual([{ markdownSrc: './missing.png', resolvedKind: 'unresolved' }]);
});
it('reports a failed actual asset conversion as unresolved', async () => {
  await driver.mount('![a](/tmp/failure.png)\n', 'any');
  boundary.unresolvedAssets.add('/tmp/failure.png');
  expect(await driver.observe('imageSources')).toEqual([{ markdownSrc: '/tmp/failure.png', resolvedKind: 'unresolved' }]);
});
it('observes clean rendered and serialized paste surfaces', async () => {
  await driver.mount('[safe](https://example.test)\n', 'any');
  expect(await driver.observe('pasteSafety')).toEqual({ forbiddenFound: [] });
});
it.each([
  ['<script>bad()</script>', 'script'], ['<img src="x" onerror="bad()">', 'onerror'],
  ['<a href="jav&#x61;script:bad()">x</a>', 'href'], ['<img src="data:text/html,bad">', 'src'],
  ['[x](javascript:bad)', 'href'], ['![x](file:///tmp/x)', 'src'],
])('finds serialized-only hazard %s', (source, marker) => {
  const root = document.createElement('div');
  expect(scanPasteSafety(source, root).forbiddenFound.some(entry => entry.includes(marker))).toBe(true);
});
it('finds DOM-only script, event handlers and refused URLs with safe serialized bytes', () => {
  const root = document.createElement('div');
  root.innerHTML = '<script>bad()</script><a onclick="bad()" href="javascript:bad()">x</a>';
  const found = scanPasteSafety('safe\n', root).forbiddenFound;
  expect(found.some(entry => entry.includes('script'))).toBe(true);
  expect(found.some(entry => entry.includes('onclick'))).toBe(true);
  expect(found.some(entry => entry.includes('href'))).toBe(true);
});
it('permits data images and local asset image rendering while still inspecting links', () => {
  const root = document.createElement('div');
  root.innerHTML = '<img src="data:image/png;base64,AAAA"><img src="asset://localhost/a">';
  expect(scanPasteSafety('![x](data:image/png;base64,AAAA)\n', root)).toEqual({ forbiddenFound: [] });
});

export {};
