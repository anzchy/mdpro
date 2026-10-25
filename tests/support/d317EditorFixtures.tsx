/**
 * Purpose: shared fixtures for the D317 Encoding-cancel focus suites. Real editor
 * views, registered the way the app registers them, around the real Encoding dialog.
 *
 * - `mountPm(docId, text, from, to)`: a real ProseMirror view, registered as the
 *   Milkdown editor (`registerEditor`) and as the ready WYSIWYG view (`readyMilkdown`).
 * - `mountCm(docId, text, from, to)`: a real CodeMirror view, set as
 *   `useEditorStore.editorView` and registered as the ready Source view.
 * - `EncodingParent`: keeps `EncodingDialog` mounted and toggles `open`, as
 *   `AppDialogs` does (every slot stays mounted), so a capture made only on first
 *   mount is visible.
 * - `domSelectionIn(pm)`: the window selection mapped back through `posAtDOM`.
 *
 * Mock boundaries stay in each test file (`@tauri-apps/api/*`).
 */
import { useState } from "react";
import { act } from "@testing-library/react";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { EditorSelection, EditorState as CmState } from "@codemirror/state";
import { EditorView as CmView } from "@codemirror/view";
import { EncodingDialog } from "../../src/components/common/EncodingDialog";
import { useDocumentStore } from "../../src/stores/documentStore";
import { useEditorStore } from "../../src/stores/editorStore";
import { useMilkdownEditorStore } from "../../src/stores/milkdownEditorStore";
import { readyMilkdown, registerReadyEditor } from "../../src/utils/focusActiveEditor";
import type { Document } from "../../src/types/document";

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} },
});

export interface PmFixture {
  view: EditorView;
  release: () => void;
  destroy: () => void;
}

export interface CmFixture {
  view: CmView;
  release: () => void;
  destroy: () => void;
}

/** Every view a test mounted, destroyed in `resetD317World` before the Range shim goes. */
const mounted = new Set<{ destroy: () => void }>();

function host(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

export function doc(id: string): Document {
  return { id, path: `/x/${id}.md`, content: "", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}

/** Make `id` the active document (and list it) in both stores. */
export function activate(id: string | null, mode: "wysiwyg" | "source" = useEditorStore.getState().viewMode): void {
  const documents = useDocumentStore.getState().documents;
  const listed = id && !documents.some((d) => d.id === id) ? [...documents, doc(id)] : documents;
  useDocumentStore.setState({ documents: listed, activeDocumentId: id });
  useEditorStore.setState({ activeDocumentId: id, viewMode: mode });
}

export function mountPm(docId: string, text: string, from: number, to = from): PmFixture {
  const parent = host();
  const pmDoc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
  const view = new EditorView(parent, { state: EditorState.create({ doc: pmDoc, selection: TextSelection.create(pmDoc, from, to) }) });
  const editor = { action: (fn: (ctx: { get: () => EditorView }) => unknown) => fn({ get: () => view }) };
  const unregister = useMilkdownEditorStore.getState().registerEditor(() => editor);
  const generation = useMilkdownEditorStore.getState().editorGenerations[docId] ?? 0;
  const release = readyMilkdown(docId, generation, view);
  const fixture: PmFixture = {
    view,
    release,
    destroy: () => { mounted.delete(fixture); release(); unregister(); view.destroy(); parent.remove(); },
  };
  mounted.add(fixture);
  return fixture;
}

export function mountCm(docId: string, text: string, from: number, to = from): CmFixture {
  const parent = host();
  const view = new CmView({ parent, state: CmState.create({ doc: text, selection: EditorSelection.range(from, to) }) });
  useEditorStore.setState({ editorView: view });
  const generation = useMilkdownEditorStore.getState().editorGenerations[docId] ?? 0;
  const release = registerReadyEditor({
    documentId: docId, generation, mode: "source", element: view.contentDOM,
    focus: () => { if (!view.dom.isConnected) return null; view.focus(); return view.contentDOM; },
  });
  const fixture: CmFixture = {
    view,
    release,
    destroy: () => { mounted.delete(fixture); release(); useEditorStore.setState({ editorView: null }); view.destroy(); parent.remove(); },
  };
  mounted.add(fixture);
  return fixture;
}

export function pmText(f: PmFixture): string {
  return f.view.state.doc.textContent;
}

export function cmText(f: CmFixture): string {
  return f.view.state.doc.toString();
}

/** The window selection, mapped back into `view`'s positions (null when outside it). */
export function domSelectionIn(view: EditorView): { anchor: number; head: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode || !sel.focusNode) return null;
  if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return null;
  return {
    anchor: view.posAtDOM(sel.anchorNode, sel.anchorOffset),
    head: view.posAtDOM(sel.focusNode, sel.focusOffset),
  };
}

export function outsideButton(label = "Outside"): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  document.body.appendChild(button);
  return button;
}

/** A stand-in for another App modal: same `.dialog-card` + `aria-modal` shape. */
export function otherModal(): { card: HTMLElement; button: HTMLButtonElement; remove: () => void } {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  const card = document.createElement("div");
  card.className = "dialog-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Other modal");
  const button = document.createElement("button");
  button.textContent = "Other action";
  card.appendChild(button);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
  return { card, button, remove: () => backdrop.remove() };
}

export interface ParentControls {
  open: () => void;
  /** Clear the issue the way App does outside a cancel (a success, an external clear). */
  clear: () => void;
  cancels: number;
  selects: string[];
}

/** Keeps the dialog mounted across openings, as `AppDialogs` keeps every slot mounted. */
export function createEncodingParent(onCancel?: () => void) {
  const controls: ParentControls = { open: () => {}, clear: () => {}, cancels: 0, selects: [] };
  function EncodingParent() {
    const [open, setOpen] = useState(false);
    controls.open = () => act(() => setOpen(true));
    controls.clear = () => act(() => setOpen(false));
    return (
      <EncodingDialog
        open={open}
        path="/x/secret-名.md"
        onSelect={(encoding) => { controls.selects.push(encoding); setOpen(false); }}
        onCancel={() => { controls.cancels += 1; onCancel?.(); setOpen(false); }}
      />
    );
  }
  return { EncodingParent, controls };
}

// jsdom has no Range layout; ProseMirror and CodeMirror measure after focus.
const RANGE_LAYOUT = ["getClientRects", "getBoundingClientRect"] as const;
let rangeShimmed: string[] = [];

export function shimRangeLayout(): void {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  rangeShimmed = RANGE_LAYOUT.filter((name) => typeof proto[name] !== "function");
  for (const name of rangeShimmed) {
    proto[name] = name === "getClientRects" ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
}

export function resetD317World(): void {
  // A live CodeMirror view measures in a later animation frame; destroy it while the
  // Range layout shim is still in place, or that frame throws after the test.
  for (const fixture of [...mounted]) fixture.destroy();
  useMilkdownEditorStore.getState().unregisterEditor();
  useEditorStore.setState({ editorView: null });
  document.body.innerHTML = "";
  const proto = Range.prototype as unknown as Record<string, unknown>;
  for (const name of rangeShimmed) delete proto[name];
  rangeShimmed = [];
}
