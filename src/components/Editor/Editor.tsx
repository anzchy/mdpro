import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorSelection, Prec } from "@codemirror/state";
import { redo, toggleLineComment, undo } from "@codemirror/commands";
import { markdownExtension } from "./extensions/markdown";
import { syntaxHighlightingExtension } from "./extensions/syntax";
import { searchExtensions } from "./extensions/search";
import {
  initialCloseBrackets,
  initialCodeTheme,
  initialTabSize,
  initialWordWrap,
} from "./extensions/dynamicExtensions";
import { reapplyEditorPrefs } from "../common/settings/editorPrefApply";
import { useDocumentStore } from "../../stores/documentStore";
import { useEditorStore } from "../../stores/editorStore";
import { pluginRegistry } from "../../plugins";
import { highlightCommand } from "../../plugins/codemirror/highlightPlugin";
import {
  isPositionInFencedCode,
  tableDetectionExtension,
} from "../../plugins/codemirror/sourceTableDetection";
import { sourceTableTabKeymap } from "../../plugins/codemirror/sourceTableTabNav";
import { sourceTableCellHighlightExtension } from "../../plugins/codemirror/sourceTableCellHighlight";
import { tableColumnCountLinter } from "../../plugins/codemirror/lintTableColumnCount";
import {
  consumePendingTableCell,
  locateCellInLines,
} from "../../utils/cursorSync/table";
import { linesFromText } from "../../plugins/codemirror/textLineSource";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  highlightRequest?: number;
}

export function Editor({
  value,
  onChange,
  readOnly = false,
  highlightRequest,
}: EditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const initializedRef = useRef(false);
  const setEditorView = useEditorStore((state) => state.setEditorView);
  const pluginExtensions = useMemo(() => pluginRegistry.getCodemirrorExtensions(), []);
  const pluginEventExtension = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          pluginRegistry.emitEvent("docChange", { mode: "codemirror" });
        }
        if (update.selectionSet) {
          pluginRegistry.emitEvent("selectionChange", { mode: "codemirror" });
        }
        if (update.focusChanged) {
          pluginRegistry.emitEvent("focusChange", {
            mode: "codemirror",
            focused: update.view.hasFocus,
          });
        }
      }),
    [],
  );

  // Memoize undo/redo keymap — identity-stable, no deps change
  const undoRedoKeymap = useMemo(
    () =>
      keymap.of([
        { key: "Mod-z", run: undo },
        { key: "Mod-Shift-z", run: redo },
        { key: "Mod-y", run: redo },
      ]),
    [],
  );

  // High-precedence keymap so Cmd+/ always cycles view modes (even when
  // CodeMirror has focus) and the line-comment shortcut moves to Cmd+Alt+/.
  // Without Prec.highest, basicSetup's defaultKeymap would bind Mod-/ to
  // toggleLineComment first.
  const viewModeKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-/",
            run: () => {
              useEditorStore.getState().cycleViewMode();
              return true;
            },
          },
          { key: "Mod-Alt-/", run: toggleLineComment },
        ]),
      ),
    [],
  );

  // Memoize the full extensions array.
  // Dynamic compartments use stable `initial*` wrappers; their values are
  // synced from persisted prefs on every mount via reapplyEditorPrefs().
  // Source-mode table support (Phase 2 WI-2.2 + WI-2.3): registered
  // BEFORE undoRedoKeymap so the table Tab handler gets first dibs;
  // it returns false outside tables so the editor's default Tab still
  // works (and code-block-tab from #d170f9c is preserved by
  // sourceTableDetection's fence guard).
  const sourceTableTabKeymapExt = useMemo(
    () => keymap.of(sourceTableTabKeymap),
    [],
  );

  const extensions = useMemo(
    () => [
      viewModeKeymap,
      markdownExtension,
      syntaxHighlightingExtension,
      ...searchExtensions,
      pluginEventExtension,
      ...pluginExtensions,
      tableDetectionExtension(),
      sourceTableTabKeymapExt,
      sourceTableCellHighlightExtension(),
      tableColumnCountLinter(),
      // Dynamic compartments — reconfigured via applyEditorPref() and related helpers.
      // Initial values are defaults; reapplyEditorPrefs() syncs them to persisted prefs.
      initialWordWrap(true),
      initialTabSize(4),
      initialCloseBrackets(true),
      initialCodeTheme("default"),
      undoRedoKeymap,
    ],
    // pluginExtensions and pluginEventExtension are stable memos; only include
    // the deps that actually change to avoid unnecessary extension churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginEventExtension, pluginExtensions, undoRedoKeymap, sourceTableTabKeymapExt, viewModeKeymap],
  );

  useEffect(() => {
    if (highlightRequest === undefined) return;
    if (viewRef.current) {
      highlightCommand(viewRef.current);
    }
  }, [highlightRequest]);

  useEffect(() => {
    return () => {
      setEditorView(null);
      if (initializedRef.current) {
        pluginRegistry.cleanup();
        initializedRef.current = false;
      }
    };
  }, [setEditorView]);

  return (
    <div className="editor-shell">
      <CodeMirror
        value={value}
        height="100%"
        extensions={extensions}
        onChange={(nextValue) => {
          if (!readOnly) {
            onChange(nextValue);
          }
        }}
        onCreateEditor={(view) => {
          viewRef.current = view;
          setEditorView(view);
          // Sync compartments with persisted prefs (handles both first mount and remount)
          reapplyEditorPrefs(view);
          pluginRegistry.setCodemirrorView(view);
          if (!initializedRef.current) {
            pluginRegistry.initialize({ currentMode: "codemirror", codemirrorView: view });
            initializedRef.current = true;
          } else {
            pluginRegistry.onModeChange("codemirror");
          }
          // WI-2.6: if the previous (WYSIWYG) view's selection was inside
          // a table, place the source cursor in the matching cell.
          // Audit-fix H1: pass the fence predicate so tableIndex is
          // resolved against the same enumeration the capture used.
          // Audit-fix M2: scope the consume to the active document so
          // a remount after a doc-switch can't apply stale coords.
          const docId = useDocumentStore.getState().activeDocumentId;
          const pending = consumePendingTableCell(docId);
          if (pending) {
            const state = view.state;
            // Over the rope (WI-3B) — the restore path is symmetric with
            // the capture in `editorStore.ts` and copies nothing.
            const offset = locateCellInLines(
              linesFromText(state.doc),
              pending,
              (pos) => isPositionInFencedCode(state, pos),
            );
            if (offset != null) {
              view.dispatch({ selection: EditorSelection.cursor(offset) });
            }
          }
        }}
        editable={!readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          // Disable built-in closeBrackets so our compartment (closeBracketsCompartment)
          // has exclusive ownership. Without this, basicSetup's copy stays active even
          // when the compartment is reconfigured to [].
          closeBrackets: false,
        }}
      />
    </div>
  );
}
