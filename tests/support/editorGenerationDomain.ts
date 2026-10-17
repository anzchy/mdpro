/**
 * @module tests/support/editorGenerationDomain
 * Purpose: the event alphabet, the real-store appliers and the shadow model
 * shared by `tests/editor-generation.test.ts` and `tests/menu-target-token.test.ts`
 * (D261-WI-1c). One definition, so the generation property and the
 * "staleness is absorbing" property draw from the same events.
 *
 * The shadow model tracks the three watched identities (the active document id,
 * the CodeMirror view, the Milkdown getter) from the SEQUENCE, never from the
 * stores, so the expected bump count is independent of the code under test.
 *
 * Callers mock `@tauri-apps/api/core` (the stores log through `invoke`).
 * Not a `*.test.ts`, so vitest does not collect it.
 *
 * @coordinates-with src/stores/editorGeneration.ts — the counter these events drive
 */
import { EditorView } from "@codemirror/view";

import { useDocumentStore } from "../../src/stores/documentStore";
import { useEditorStore } from "../../src/stores/editorStore";
import { useMilkdownEditorStore } from "../../src/stores/milkdownEditorStore";
import type { Document } from "../../src/types/document";

export const GEN_EVENTS = [
  "switch-other",
  "switch-same",
  "view-new",
  "view-same",
  "view-null",
  "getter-new",
  "getter-same",
  "unregister",
  "content",
  "selection",
] as const;
export type GenEvent = (typeof GEN_EVENTS)[number];

export function doc(id: string, content = ""): Document {
  return { id, path: `/x/${id}.md`, content, encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 0 };
}

/** The identities the test believes the stores hold. */
export type Shadow = { active: string; view: EditorView | null; getter: (() => unknown) | null; typed: number };

/** Open d1 and d2 with d1 active, no view, no Milkdown getter, no flushers. */
export function seedStores(): Shadow {
  useMilkdownEditorStore.setState({ flushers: {} });
  useMilkdownEditorStore.getState().unregisterEditor();
  useEditorStore.getState().setEditorView(null);
  useDocumentStore.setState({ documents: [doc("d1"), doc("d2")], activeDocumentId: "d1" });
  return { active: "d1", view: null, getter: null, typed: 0 };
}

export const newView = (): EditorView => new EditorView({ doc: "" });

/**
 * Apply one event through the real store actions and return how many bumps the
 * shadow model expects it to cause (0 or 1). Updates `shadow` in place.
 */
export function applyGenEvent(event: GenEvent, shadow: Shadow): number {
  switch (event) {
    case "switch-other": {
      const next = shadow.active === "d1" ? "d2" : "d1";
      useDocumentStore.getState().setActiveDocument(next);
      shadow.active = next;
      return 1;
    }
    case "switch-same":
      useDocumentStore.getState().setActiveDocument(shadow.active);
      return 0;
    case "view-new": {
      const view = newView();
      useEditorStore.getState().setEditorView(view);
      shadow.view = view;
      return 1;
    }
    case "view-same":
      useEditorStore.getState().setEditorView(shadow.view);
      return 0;
    case "view-null": {
      const bumps = shadow.view === null ? 0 : 1;
      useEditorStore.getState().setEditorView(null);
      shadow.view = null;
      return bumps;
    }
    case "getter-new": {
      const getter = () => ({ editor: "milkdown" });
      useMilkdownEditorStore.getState().registerEditor(getter);
      shadow.getter = getter;
      return 1;
    }
    case "getter-same":
      if (shadow.getter) useMilkdownEditorStore.getState().registerEditor(shadow.getter);
      else useMilkdownEditorStore.getState().unregisterEditor();
      return 0;
    case "unregister": {
      const bumps = shadow.getter === null ? 0 : 1;
      useMilkdownEditorStore.getState().unregisterEditor();
      shadow.getter = null;
      return bumps;
    }
    case "content":
      shadow.typed += 1;
      useDocumentStore.getState().updateDocumentContent(shadow.active, `typed ${shadow.typed}`);
      return 0;
    case "selection":
      useEditorStore.getState().setCursor({ line: shadow.typed, column: 1 });
      useEditorStore.getState().setSelection({ anchor: { line: 0, column: 0 }, head: { line: 0, column: shadow.typed } });
      return 0;
  }
}
