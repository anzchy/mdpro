import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import type { CursorPosition, EditorState, ScrollPosition, SelectionRange, ViewMode } from "../types/editor";
import { loggingService } from "../services/loggingService";
import {
  captureCellFromSource,
  setPendingTableCell,
  type TableCellPos,
} from "../utils/cursorSync/table";
import { captureCellFromMilkdownEditor } from "../utils/cursorSync/tableMilkdown";
import { isPositionInFencedCode } from "../plugins/codemirror/sourceTableDetection";
import { useDocumentStore } from "./documentStore";
import { useMilkdownEditorStore } from "./milkdownEditorStore";

/**
 * Capture the current table cell on the OUTGOING editor before the
 * mode transition mutates state (Phase 2 WI-2.6). Always writes the
 * pending slot — falls through to null when the cursor isn't in a
 * table, which clears any stale capture from a previous transition.
 *
 * Audit-fix H2 (2026-05-03): source-mode capture is fence-guarded —
 * a cursor inside a fenced code block writes null instead of phantom
 * coords (matches the H1 fence guard inside `findAllTables`).
 *
 * Audit-fix M1 (2026-05-03): the slot is paired with `documentId` so
 * a doc-switch between this capture and the inbound editor's mount
 * doesn't apply stale coords to a different document.
 */
function capturePendingTableCellForTransition(
  fromMode: ViewMode,
  cmView: EditorView | null,
): void {
  let captured: TableCellPos | null = null;
  if (fromMode === "source" && cmView) {
    const state = cmView.state;
    captured = captureCellFromSource(
      state.doc.toString(),
      state.selection.main.head,
      (pos) => isPositionInFencedCode(state, pos),
    );
  } else if (fromMode === "wysiwyg") {
    const editor = useMilkdownEditorStore.getState().getEditor();
    if (editor) {
      captured = captureCellFromMilkdownEditor(editor);
    }
  }
  if (!captured) {
    setPendingTableCell(null);
    return;
  }
  const documentId = useDocumentStore.getState().activeDocumentId;
  if (!documentId) {
    setPendingTableCell(null);
    return;
  }
  setPendingTableCell({ documentId, pos: captured });
}

interface EditorStore extends EditorState {
  showSidebar: boolean;
  /** Auto-save interval in seconds (0 = off). Decision 1A: lives here so useAutoSave reacts immediately. */
  autoSaveInterval: number;
  setAutoSaveInterval: (seconds: number) => void;
  setActiveDocumentId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  cycleViewMode: () => void;
  editorView: EditorView | null;
  setEditorView: (view: EditorView | null) => void;
  setShowSidebar: (show: boolean) => void;
  toggleSidebar: () => void;
  setCursor: (cursor: CursorPosition) => void;
  setSelection: (selection: SelectionRange | null) => void;
  setEditorScroll: (scroll: ScrollPosition) => void;
  setPreviewScroll: (scroll: ScrollPosition) => void;
  setFocus: (isFocused: boolean) => void;
  setUndoDepth: (depth: number) => void;
  setRedoDepth: (depth: number) => void;
}

const defaultScroll: ScrollPosition = {
  top: 0,
  firstVisibleLine: 0,
};

const defaultCursor: CursorPosition = {
  line: 0,
  column: 0,
};

export const useEditorStore = create<EditorStore>((set) => ({
  activeDocumentId: null,
  viewMode: "wysiwyg",
  showSidebar: true,
  autoSaveInterval: 30,
  setAutoSaveInterval: (seconds) => set({ autoSaveInterval: seconds }),
  editorView: null,
  cursor: { ...defaultCursor },
  selection: null,
  editorScroll: { ...defaultScroll },
  previewScroll: { ...defaultScroll },
  isFocused: false,
  undoDepth: 0,
  redoDepth: 0,
  setActiveDocumentId: (id) => set({ activeDocumentId: id }),
  setViewMode: (mode) =>
    set((state) => {
      if (state.viewMode !== mode) {
        // WI-2.6: capture cell on the outgoing editor BEFORE we mutate
        // viewMode — React reconciles after this set() returns, so the
        // outgoing editor is still mounted right now.
        capturePendingTableCellForTransition(state.viewMode, state.editorView);
        loggingService.logEventSync({
          level: "info",
          event: "view.mode.change",
          status: "success",
          actionId: loggingService.generateActionId(),
          context: {
            fromMode: state.viewMode,
            toMode: mode,
            source: "setViewMode",
          },
        });
      }
      return { viewMode: mode };
    }),
  cycleViewMode: () =>
    set((state) => {
      const order: ViewMode[] = ["wysiwyg", "source"];
      const currentIndex = order.indexOf(state.viewMode);
      const nextIndex =
        currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
      const nextMode = order[nextIndex];
      if (nextMode !== state.viewMode) {
        capturePendingTableCellForTransition(state.viewMode, state.editorView);
        loggingService.logEventSync({
          level: "info",
          event: "view.mode.change",
          status: "success",
          actionId: loggingService.generateActionId(),
          context: {
            fromMode: state.viewMode,
            toMode: nextMode,
            source: "cycleViewMode",
          },
        });
      }
      return { viewMode: nextMode };
    }),
  setEditorView: (view) => set({ editorView: view }),
  setShowSidebar: (show) => set({ showSidebar: show }),
  toggleSidebar: () => set((state) => ({ showSidebar: !state.showSidebar })),
  setCursor: (cursor) => set({ cursor }),
  setSelection: (selection) => set({ selection }),
  setEditorScroll: (scroll) => set({ editorScroll: scroll }),
  setPreviewScroll: (scroll) => set({ previewScroll: scroll }),
  setFocus: (isFocused) => set({ isFocused }),
  setUndoDepth: (depth) => set({ undoDepth: depth }),
  setRedoDepth: (depth) => set({ redoDepth: depth }),
}));
