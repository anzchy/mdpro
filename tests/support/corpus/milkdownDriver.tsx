/** Real production editor host: fresh stores, real Source/WYSIWYG mounts, real serializer and save decision path. */
import { act, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { EditorStatus, editorViewCtx } from '@milkdown/kit/core';
import type { Editor } from '@milkdown/kit/core';
import { getMarkdown } from '@milkdown/kit/utils';
import { MilkdownEditor } from '../../../src/components/Editor/MilkdownEditor';
import { SplitView } from '../../../src/components/Editor/SplitView';
import { useDocumentStore } from '../../../src/stores/documentStore';
import { useMilkdownEditorStore } from '../../../src/stores/milkdownEditorStore';
import { useEditorStore } from '../../../src/stores/editorStore';
import { useTOCStore } from '../../../src/stores/tocStore';
import { useExternalChangeStore } from '../../../src/stores/externalChangeStore';
import { useToastStore } from '../../../src/stores/toastStore';
import { useLinkInsertStore } from '../../../src/stores/linkInsertStore';
import { useTableInsertStore } from '../../../src/stores/tableInsertStore';
import { setPendingTableCell } from '../../../src/utils/cursorSync/table';
import { setPendingScrollAnchor } from '../../../src/utils/scrollAnchor/anchor';
import { saveActiveDocument } from '../../../src/services/documentSave';
import type { Document } from '../../../src/types/document';
import type { CorpusDriver, DriverObservationKind, LinkActivation, ObservationMap, Platform, ViewMode } from './types.ts';
import type { FakeTauriBoundary } from './fakeBoundary.ts';
import type { MilkdownDriverRuntime } from './milkdownDriverTypes.ts';
import { runDriverAction } from './driverActions.ts';
import { observeDriver } from './driverObservations.ts';
import { clickLink } from './linkActivation.ts';
import { installDriverDOMBoundary } from './milkdownDriverEnvironment.ts';
export interface MilkdownDriverOptions { caseId?: string; documentPath?: string | null }
const READY_TIMEOUT = 5000;
const CLOCK = new Date('2026-01-01T00:00:00Z');
function Host() {
  const mode = useEditorStore(state => state.viewMode);
  const active = useDocumentStore(state => state.documents.find(doc => doc.id === state.activeDocumentId));
  return mode === 'wysiwyg' ? <MilkdownEditor /> : <SplitView markdown={active?.content ?? ''}
    onChange={content => { const id = useDocumentStore.getState().activeDocumentId; if (id) useDocumentStore.getState().updateDocumentContent(id, content); }} />;
}
function resetStores(): void {
  useToastStore.getState().clearToast();
  useLinkInsertStore.setState(useLinkInsertStore.getInitialState(), true);
  useTableInsertStore.setState(useTableInsertStore.getInitialState(), true);
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useMilkdownEditorStore.setState(useMilkdownEditorStore.getInitialState(), true);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useTOCStore.setState(useTOCStore.getInitialState(), true);
  useExternalChangeStore.setState(useExternalChangeStore.getInitialState(), true);
  setPendingTableCell(null); setPendingScrollAnchor(null);
}
export function createMilkdownDriver(boundary: FakeTauriBoundary, options: MilkdownDriverOptions = {}): CorpusDriver {
  const caseId = options.caseId ?? 'corpus-driver';
  const documentPath = options.documentPath === undefined ? `/tmp/corpus/${caseId}.md` : options.documentPath;
  let rendered: ReturnType<typeof render> | null = null;
  let restoreDOM: (() => void) | undefined;
  let input = '', platform: Platform = 'any';
  let lastActivation: LinkActivation | undefined;
  const error = (message: string) => new Error(`${caseId}: ${message}`);
  const instance = (): Editor => {
    const editor = useMilkdownEditorStore.getState().getEditor() as Editor | null;
    if (!rendered || !editor || editor.status !== EditorStatus.Created) throw error('no live WYSIWYG editor');
    return editor;
  };
  const runtime: MilkdownDriverRuntime = {
    caseId, editor: instance,
    view: () => {
      const view = instance().action(ctx => ctx.get(editorViewCtx));
      if (view.isDestroyed || !view.dom.isConnected) throw error('WYSIWYG view is detached');
      return view;
    },
    mode: () => useEditorStore.getState().viewMode,
    modeSwitch: async (mode: ViewMode) => {
      if (!rendered) throw error('mount required before mode switch');
      await act(async () => { useEditorStore.getState().setViewMode(mode, 'user'); });
      if (useEditorStore.getState().viewMode !== mode) throw error('production mode transition was refused');
      await waitFor(() => {
        if (mode === 'wysiwyg') runtime.view();
        else if (!useEditorStore.getState().editorView?.dom.isConnected) throw error('Source view not ready');
      }, { timeout: READY_TIMEOUT });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    },
  };
  async function cleanup(): Promise<void> {
    const previous = useMilkdownEditorStore.getState().getEditor() as Editor | null;
    if (rendered) {
      await act(async () => { rendered!.unmount(); }); rendered = null;
      if (previous) await waitFor(() => { if (previous.status !== EditorStatus.Destroyed) throw error('previous editor still destroying'); }, { timeout: READY_TIMEOUT });
    }
    lastActivation = undefined;
    resetStores(); restoreDOM?.(); restoreDOM = undefined; vi.useRealTimers();
  }
  async function mountHost(content: string, target: Platform, clearBoundary: boolean): Promise<void> {
    await cleanup();
    if (clearBoundary) boundary.reset();
    input = content; platform = target;
    Object.defineProperty(navigator, 'platform', { value: target === 'win' ? 'Win32' : 'MacIntel', configurable: true });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(CLOCK);
    restoreDOM = installDriverDOMBoundary();
    if (documentPath) boundary.seed(documentPath, content);
    const doc: Document = { id: `${caseId}-document`, path: documentPath, content, savedContent: content,
      encoding: 'UTF-8', lineEnding: 'lf', isModified: false, lastSaved: null, fileSize: new TextEncoder().encode(content).length };
    await act(async () => { useDocumentStore.getState().upsertDocument(doc); useDocumentStore.getState().setActiveDocumentId(doc.id); rendered = render(<Host />); });
    await waitFor(() => runtime.view(), { timeout: READY_TIMEOUT });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  return {
    mount: (content, target) => mountHost(content, target, true),
    async untouched() {
      if (!rendered) throw error('mount required before untouched');
      await runtime.modeSwitch('source'); await runtime.modeSwitch('wysiwyg');
      const start = boundary.writeLog.length;
      await act(async () => { const saved = await saveActiveDocument(); if (!saved?.success) throw error('untouched save was refused'); });
      const writes = boundary.writeLog.slice(start).filter(write => write.command === 'save_file' || (write.command as string) === 'save_file_dialog');
      if (writes.length !== 1) throw error('untouched must observe exactly one real save');
      const bytes = writes[0].content;
      if (documentPath === null) await mountHost(input, platform, false);
      return bytes;
    },
    async serialize() {
      if (!rendered) throw error('mount required before serialization');
      if (runtime.mode() === 'source') await runtime.modeSwitch('wysiwyg');
      return runtime.editor().action(getMarkdown());
    },
    async runAction(action) {
      try {
        if (action.kind === 'activateLink') await act(async () => { lastActivation = await clickLink(runtime, boundary, action.link); });
        else if (action.kind === 'modeSwitch') await runDriverAction(runtime, action);
        else await act(async () => { await runDriverAction(runtime, action); });
      }
      catch (cause) { throw error(cause instanceof Error ? cause.message : String(cause)); }
    },
    async observe<K extends DriverObservationKind>(kind: K): Promise<ObservationMap[K]> {
      if (kind === 'linkActivation') {
        if (!lastActivation) throw error('no link activation');
        return structuredClone(lastActivation) as ObservationMap[K];
      }
      return observeDriver(runtime, kind);
    }, cleanup,
  };
}
