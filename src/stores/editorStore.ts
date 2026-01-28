import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import type { CursorPosition, EditorState, ScrollPosition, SelectionRange, ViewMode } from "../types/editor";
import { loggingService } from "../services/loggingService";

interface EditorStore extends EditorState {
  showSidebar: boolean;
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
  viewMode: "split",
  showSidebar: true,
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
      const order: ViewMode[] = [
        "split",
        "editor-only",
        "preview-only",
        "wysiwyg",
      ];
      const currentIndex = order.indexOf(state.viewMode);
      const nextIndex =
        currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
      const nextMode = order[nextIndex];
      if (nextMode !== state.viewMode) {
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
