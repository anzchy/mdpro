export type ViewMode = "split" | "editor-only" | "preview-only" | "wysiwyg";

export interface CursorPosition {
  /** Line number (0-indexed) */
  line: number;

  /** Column/character position (0-indexed) */
  column: number;
}

export interface SelectionRange {
  /** Start position */
  anchor: CursorPosition;

  /** End position (same as anchor if no selection) */
  head: CursorPosition;
}

export interface ScrollPosition {
  /** Scroll offset from top (pixels) */
  top: number;

  /** First visible line number */
  firstVisibleLine: number;
}

export interface EditorState {
  /** Currently active document ID */
  activeDocumentId: string | null;

  /** Current view mode */
  viewMode: ViewMode;

  /** Cursor position in editor */
  cursor: CursorPosition;

  /** Current text selection */
  selection: SelectionRange | null;

  /** Editor scroll position */
  editorScroll: ScrollPosition;

  /** Preview scroll position (for sync) */
  previewScroll: ScrollPosition;

  /** Is editor focused */
  isFocused: boolean;

  /** Undo stack depth (for UI indicators) */
  undoDepth: number;

  /** Redo stack depth */
  redoDepth: number;
}
