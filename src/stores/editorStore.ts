import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import type { CursorPosition, EditorState, SelectionRange, ViewMode } from "../types/editor";
import { loggingService } from "../services/loggingService";
import {
  captureCellFromLines,
  setPendingTableCell,
  type TableCellPos,
} from "../utils/cursorSync/table";
import { captureCellFromMilkdownEditor } from "../utils/cursorSync/tableMilkdown";
import { isPositionInFencedCode } from "../plugins/codemirror/sourceTableDetection";
import { linesFromText } from "../plugins/codemirror/textLineSource";
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
/**
 * Audit-fix L2: setViewMode and cycleViewMode share the same
 * pre-transition work — capture the table cell on the outgoing
 * editor, then log the change. Extract into one helper so a future
 * tweak (e.g., capture image-resize state too) lands in one place.
 */
function runViewModeTransition(
  state: { viewMode: ViewMode; editorView: EditorView | null },
  toMode: ViewMode,
  source: "setViewMode" | "cycleViewMode",
): void {
  capturePendingTableCellForTransition(state.viewMode, state.editorView);
  loggingService.logEventSync({
    level: "info",
    event: "view.mode.change",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: { fromMode: state.viewMode, toMode, source },
  });
}

function capturePendingTableCellForTransition(
  fromMode: ViewMode,
  cmView: EditorView | null,
): void {
  let captured: TableCellPos | null = null;
  if (fromMode === "source" && cmView) {
    const state = cmView.state;
    // Over the rope (WI-3B). A mode toggle on a multi-MB document no
    // longer copies the document just to find the cursor's cell.
    captured = captureCellFromLines(
      linesFromText(state.doc),
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
  setFocus: (isFocused: boolean) => void;
  setUndoDepth: (depth: number) => void;
  setRedoDepth: (depth: number) => void;
  /**
   * Per-document Source table verdicts (ADR-0022, plan amendment A1). The first
   * verdict recorded for a document id is kept for the session.
   */
  sourceTableVerdicts: Record<string, SourceTableVerdict>;
  /**
   * Record the Source table verdict for `docId`. Returns `true` only when this
   * is the first verdict for that id. A recorded verdict is sticky: later calls
   * for the same id return `false` without calling `set`, so state stays
   * referentially unchanged and no subscriber is notified.
   */
  recordSourceTableVerdict: (docId: string, verdict: SourceTableVerdict) => boolean;
}

/** What App's Source guard concluded about a document's table extensions. */
export type SourceTableVerdict = "allowed" | "withheld";

/** The full editor store state, for pure selectors and helpers. */
export type EditorStoreState = EditorStore;

type VerdictState = Pick<EditorStore, "sourceTableVerdicts">;

/**
 * Own-property lookup, so prototype names ("constructor", "__proto__",
 * "toString") read as absent on an empty record.
 */
function verdictOf(state: VerdictState, docId: string | null): SourceTableVerdict | null {
  if (docId === null) return null;
  const verdicts = state.sourceTableVerdicts;
  return Object.prototype.hasOwnProperty.call(verdicts, docId) ? verdicts[docId] : null;
}

/** True when `docId` has a recorded "withheld" verdict. */
export function isSourceTablesWithheld(state: VerdictState, docId: string | null): boolean {
  return verdictOf(state, docId) === "withheld";
}

/** True when `docId` has any recorded verdict, "allowed" or "withheld". */
export function hasSourceTableVerdict(state: VerdictState, docId: string | null): boolean {
  return verdictOf(state, docId) !== null;
}

const defaultCursor: CursorPosition = {
  line: 0,
  column: 0,
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  activeDocumentId: null,
  viewMode: "wysiwyg",
  showSidebar: true,
  autoSaveInterval: 30,
  setAutoSaveInterval: (seconds) => set({ autoSaveInterval: seconds }),
  editorView: null,
  cursor: { ...defaultCursor },
  selection: null,
  isFocused: false,
  undoDepth: 0,
  redoDepth: 0,
  setActiveDocumentId: (id) => set({ activeDocumentId: id }),
  setViewMode: (mode) =>
    set((state) => {
      if (state.viewMode === mode) return { viewMode: mode };
      runViewModeTransition(state, mode, "setViewMode");
      return { viewMode: mode };
    }),
  cycleViewMode: () =>
    set((state) => {
      const order: ViewMode[] = ["wysiwyg", "source"];
      const currentIndex = order.indexOf(state.viewMode);
      const nextIndex =
        currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
      const nextMode = order[nextIndex];
      if (nextMode === state.viewMode) return { viewMode: nextMode };
      runViewModeTransition(state, nextMode, "cycleViewMode");
      return { viewMode: nextMode };
    }),
  setEditorView: (view) => set({ editorView: view }),
  setShowSidebar: (show) => set({ showSidebar: show }),
  toggleSidebar: () => set((state) => ({ showSidebar: !state.showSidebar })),
  setCursor: (cursor) => set({ cursor }),
  setSelection: (selection) => set({ selection }),
  setFocus: (isFocused) => set({ isFocused }),
  setUndoDepth: (depth) => set({ undoDepth: depth }),
  setRedoDepth: (depth) => set({ redoDepth: depth }),
  sourceTableVerdicts: {},
  recordSourceTableVerdict: (docId, verdict) => {
    if (hasSourceTableVerdict(get(), docId)) return false;
    set((state) => ({
      sourceTableVerdicts: { ...state.sourceTableVerdicts, [docId]: verdict },
    }));
    return true;
  },
}));
