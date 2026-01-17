import { create } from "zustand";
import type { CursorPosition, EditorState, ScrollPosition, SelectionRange, ViewMode } from "../types/editor";

interface EditorStore extends EditorState {
  showSidebar: boolean;
  setActiveDocumentId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
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
  cursor: { ...defaultCursor },
  selection: null,
  editorScroll: { ...defaultScroll },
  previewScroll: { ...defaultScroll },
  isFocused: false,
  undoDepth: 0,
  redoDepth: 0,
  setActiveDocumentId: (id) => set({ activeDocumentId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),
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
