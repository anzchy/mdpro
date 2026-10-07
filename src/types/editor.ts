export type ViewMode = "wysiwyg" | "source";

/**
 * Who asked for a view-mode switch (ADR-0031 step 6). Only `"user"`, the four
 * explicit commands (menu set, menu cycle, the cycle shortcut, the Source
 * editor's `Mod-/`), counts as a choice worth persisting. Every other switch is
 * `"programmatic"`, and that is the default, so an unlabeled caller fails closed.
 */
export type ViewModeIntent = "user" | "programmatic";

/**
 * The latest explicit view-mode choice. `seq` counts user commands (it bumps
 * even when the mode did not change), and `mode` is where the last one landed.
 */
export interface UserViewModeChoice {
  seq: number;
  mode: ViewMode;
}

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

export interface EditorState {
  /** Currently active document ID */
  activeDocumentId: string | null;

  /** Current view mode */
  viewMode: ViewMode;

  /** Cursor position in editor */
  cursor: CursorPosition;

  /** Current text selection */
  selection: SelectionRange | null;

  /** Is editor focused */
  isFocused: boolean;

  /** Undo stack depth (for UI indicators) */
  undoDepth: number;

  /** Redo stack depth */
  redoDepth: number;
}
