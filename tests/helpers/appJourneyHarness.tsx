import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { EditorStatus, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import type { Editor } from '@milkdown/kit/core';
import { vi } from 'vitest';
import { AppJourneyBoundary, installAppJourneyBoundary } from './appJourneyBoundary';

const CASES = JSON.parse(readFileSync(resolve('tests/fixtures/markdown-corpus/a.json'), 'utf8')) as
  Array<{ caseId: string; input: string }>;
const CLOCK = new Date('2026-01-01T00:00:00Z');

export interface JourneyTokens {
  lifetime: number; replacement: number; baselineById: number; baselineByPath: number;
  reload: number; editorGeneration: number;
  menuTarget: { windowLabel: string; documentId: string | null; generation: number };
}

export async function createAppJourney(options: { strictMode?: boolean } = {}) {
  const boundary = new AppJourneyBoundary();
  installAppJourneyBoundary(boundary);
  const [{ default: App }, { useDocumentStore }, { useEditorStore }, { useMilkdownEditorStore },
    { useExternalChangeStore }, { useToastStore }, { getEditorGeneration }, { captureToken }] = await Promise.all([
      import('../../src/App'), import('../../src/stores/documentStore'), import('../../src/stores/editorStore'),
      import('../../src/stores/milkdownEditorStore'), import('../../src/stores/externalChangeStore'),
      import('../../src/stores/toastStore'), import('../../src/stores/editorGeneration'),
      import('../../src/utils/menuTargetToken'),
    ]);
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useMilkdownEditorStore.setState(useMilkdownEditorStore.getInitialState(), true);
  useExternalChangeStore.setState(useExternalChangeStore.getInitialState(), true);
  useToastStore.setState(useToastStore.getInitialState(), true);
  useEditorStore.setState({ viewMode: 'wysiwyg' });
  const startingEditorGeneration = getEditorGeneration();
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  const oldGetClientRects = Range.prototype.getClientRects;
  const oldGetBoundingClientRect = Range.prototype.getBoundingClientRect;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);

  const realNow = performance.now.bind(performance);
  vi.useFakeTimers();
  vi.setSystemTime(CLOCK);
  const fakeSetTimeout = globalThis.setTimeout;
  const milkdownTimers = new Set<number>();
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = fakeSetTimeout(handler, timeout, ...args);
    if (typeof handler === 'function' && handler.toString().includes('ifTimeout()')) milkdownTimers.add(id);
    return id;
  }) as typeof setTimeout;

  const transitions: Array<{ source: 'document' | 'milkdown'; activeId: string | null; documents: Array<{ id: string; content: string; dirty: boolean }> }> = [];
  const snapshot = (source: 'document' | 'milkdown') => {
    const state = useDocumentStore.getState();
    transitions.push({ source, activeId: state.activeDocumentId,
      documents: state.documents.map(doc => ({ id: doc.id, content: doc.content, dirty: doc.isModified })) });
  };
  const unsubscribeDocument = useDocumentStore.subscribe(() => snapshot('document'));
  const unsubscribeMilkdown = useMilkdownEditorStore.subscribe(() => snapshot('milkdown'));
  const mountedAt = realNow();
  const view = render(options.strictMode ? <StrictMode><App /></StrictMode> : <App />);

  async function flushMicrotasks() {
    await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
  }
  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await flushMicrotasks();
  }
  await flushMicrotasks();
  await advance(500);
  const mountMs = realNow() - mountedAt;

  function editor(): Editor {
    const current = useMilkdownEditorStore.getState().getEditor() as Editor | null;
    if (!current || current.status !== EditorStatus.Created) throw new Error('App Milkdown editor not ready');
    return current;
  }
  function readTokens(id: string): JourneyTokens {
    const state = useDocumentStore.getState();
    const doc = state.getDocumentById(id);
    const milkdown = useMilkdownEditorStore.getState();
    return {
      lifetime: state.lifetimeEpoch[id] ?? 0,
      replacement: state.replacementEpoch[id] ?? 0,
      baselineById: state.baselineEpoch[id] ?? 0,
      baselineByPath: doc?.path ? state.baselinePathEpoch[doc.path] ?? 0 : 0,
      reload: milkdown.editorGenerations[id] ?? 0,
      editorGeneration: getEditorGeneration() - startingEditorGeneration,
      menuTarget: captureToken('main'),
    };
  }
  async function openCase(caseId: string) {
    const entry = CASES.find(item => item.caseId === caseId);
    if (!entry) throw new Error(`unknown corpus case: ${caseId}`);
    const content = readFileSync(resolve('tests/fixtures/markdown-corpus', entry.input), 'utf8');
    const path = `/tmp/mig002/${caseId}.md`;
    boundary.corpus.seed(path, content);
    boundary.emit('file:open', [path], true);
    await flushMicrotasks();
    for (let i = 0; i < 30 && (!useDocumentStore.getState().activeDocumentId ||
      useMilkdownEditorStore.getState().getEditor() === null); i += 1) await advance(10);
    const id = useDocumentStore.getState().activeDocumentId;
    if (!id) throw new Error(`App did not open ${caseId}`);
    for (let i = 0; i < 30; i += 1) {
      try { editor(); break; } catch { await advance(10); }
    }
    editor();
    return { id, path, content, mountMs: realNow() - mountedAt };
  }
  async function type(text: string) {
    const instance = editor();
    const pmView = instance.action(ctx => ctx.get(editorViewCtx));
    const end = pmView.state.doc.content.size - 1;
    await act(async () => { pmView.dispatch(pmView.state.tr.insertText(text, end)); });
  }
  async function compose(text: string) {
    const pmView = editor().action(ctx => ctx.get(editorViewCtx));
    const element = pmView.dom;
    await act(async () => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }));
      const end = pmView.state.doc.content.size - 1;
      pmView.dispatch(pmView.state.tr.insertText(text, end));
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
    });
  }
  function breakSerializer() {
    const pmView = editor().action(ctx => ctx.get(editorViewCtx));
    const s = pmView.state.schema;
    const list = s.nodes.bullet_list.create(null, [s.nodes.list_item.create(null, [])]);
    pmView.dispatch(pmView.state.tr.insert(pmView.state.doc.content.size, list));
    const serialize = editor().action(ctx => ctx.get(serializerCtx));
    try { serialize(pmView.state.doc); } catch { return; }
    throw new Error('real serializer did not break');
  }
  function healSerializer() {
    const pmView = editor().action(ctx => ctx.get(editorViewCtx));
    const ranges: Array<[number, number]> = [];
    pmView.state.doc.forEach((node, offset) => {
      if (node.type.name === 'bullet_list') ranges.push([offset, offset + node.nodeSize]);
    });
    let tr = pmView.state.tr;
    for (const [from, to] of ranges.reverse()) tr = tr.delete(from, to);
    pmView.dispatch(tr);
  }
  async function menu(action: string) {
    await act(async () => { boundary.emit('menu:action', { action, target: 'main' }, true); });
    await flushMicrotasks();
  }
  async function cleanup() {
    await act(async () => { view.unmount(); });
    await flushMicrotasks();
    unsubscribeDocument(); unsubscribeMilkdown();
    useToastStore.getState().clearToast();
    for (const timer of milkdownTimers) clearTimeout(timer);
    const pending = vi.getTimerCount();
    const listeners = boundary.liveListeners;
    const flushers = Object.values(useMilkdownEditorStore.getState().flushers).flat().length;
    globalThis.setTimeout = fakeSetTimeout;
    vi.useRealTimers();
    Range.prototype.getClientRects = oldGetClientRects;
    Range.prototype.getBoundingClientRect = oldGetBoundingClientRect;
    if (pending || listeners || flushers) throw new Error(`journey leaked timers=${pending} listeners=${listeners} flushers=${flushers}: ${boundary.liveListenerNames.join(', ')}`);
  }
  return { boundary, view, transitions, mountMs, advance, flushMicrotasks, openCase, editor,
    readTokens, type, compose, breakSerializer, healSerializer, menu, cleanup,
    documentStore: useDocumentStore, editorStore: useEditorStore, milkdownStore: useMilkdownEditorStore,
    toastStore: useToastStore };
}
