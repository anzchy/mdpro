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
import { isPositionInFencedCode } from "../../plugins/codemirror/sourceTableDetection";
import { sourceTableTabKeymap } from "../../plugins/codemirror/sourceTableTabNav";
import { sourceTableExtensions } from "../../plugins/codemirror/sourceTableExtensions";
import { useSourceTablesWithheld } from "../../hooks/useSourceTablesWithheld";
import {
  consumePendingTableCell,
  locateCellInLines,
} from "../../utils/cursorSync/table";
import { linesFromText } from "../../plugins/codemirror/textLineSource";
import { restoreSourceScrollAnchor } from "../../utils/scrollAnchor/source";

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
  // ADR-0022: true when the active document's Source table verdict is
  // "withheld". A subscription (not a getState() read) because App's guard
  // effect records the verdict after this component mounts.
  const sourceTablesWithheld = useSourceTablesWithheld();
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

  // Source-mode table Tab / Shift-Tab (Phase 2 WI-2.3, D40). @uiw/react-codemirror
  // puts its default `keymap.of([indentWithTab])` ahead of every extension we
  // pass, so no array position here can outrank it — precedence comes from
  // Prec.high alone. tableTabCommand returns false only when no selected line
  // is a table line (prose, fenced code, withheld documents), falling through
  // to that default indent, which is also code-block Tab (#d170f9c). When it
  // touches a table but cannot navigate (delimiter row, write-guard refusal,
  // Shift-Tab in the first cell, mixed or multi-table selections) it swallows
  // the key instead (D41, ADR-0046). Cost: inside a table this outranks any
  // future default-precedence Tab binding.
  const sourceTableTabKeymapExt = useMemo(
    () => Prec.high(keymap.of(sourceTableTabKeymap)),
    [],
  );

  // Memoize the full extensions array.
  // Dynamic compartments use stable `initial*` wrappers; their values are
  // synced from persisted prefs on every mount via reapplyEditorPrefs().
  const extensions = useMemo(
    () => [
      viewModeKeymap,
      markdownExtension,
      syntaxHighlightingExtension,
      ...searchExtensions,
      pluginEventExtension,
      ...pluginExtensions,
      // Detection, Tab keymap, cell highlight, column-count linter — in this
      // order, or none of them when the document is withheld (ADR-0022).
      ...sourceTableExtensions({
        withheld: sourceTablesWithheld,
        tabKeymap: sourceTableTabKeymapExt,
      }),
      // Dynamic compartments — reconfigured via applyEditorPref() and related helpers.
      // Initial values are defaults; reapplyEditorPrefs() syncs them to persisted prefs.
      initialWordWrap(true),
      initialTabSize(4),
      initialCloseBrackets(true),
      initialCodeTheme("default"),
      undoRedoKeymap,
    ],
    // pluginExtensions and pluginEventExtension are stable memos; the only dep
    // that actually changes is sourceTablesWithheld (per document switch or
    // verdict), so this array keeps its identity across renders otherwise.
    // That does not stop reconfigures: the inline `onChange` and `basicSetup`
    // literal below are also useCodeMirror deps, so every Editor render
    // (each keystroke included) dispatches a StateEffect.reconfigure.
    // The listed memos are kept for readability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginEventExtension, pluginExtensions, undoRedoKeymap, sourceTableTabKeymapExt, viewModeKeymap, sourceTablesWithheld],
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
          // WI-8: restore the outgoing editor's top visible line. After the
          // table-cell restore so the scroll position wins over the cursor.
          restoreSourceScrollAnchor(view, docId);
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
