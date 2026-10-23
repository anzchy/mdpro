import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { defaultKeymap, redo, toggleLineComment, undo } from "@codemirror/commands";
import { markdownExtension } from "./extensions/markdown";
import { syntaxHighlightingExtension } from "./extensions/syntax";
import { searchExtensionsFor } from "./extensions/search";
import { appliedKey, defaultAppliedShortcuts, withAppliedShortcuts } from "../../commands/appliedKeymap";
import { isMacPlatform } from "../../utils/platformLabels";
import { installAltGrGuard } from "../../plugins/codemirror/altGrGuard";
import {
  initialCloseBrackets,
  initialCodeTheme,
  initialTabSize,
  initialWordWrap,
} from "./extensions/dynamicExtensions";
import { sourceEditorTheme } from "./extensions/appTheme";
import { reapplyEditorPrefs } from "../common/settings/editorPrefApply";
import { useDocumentStore } from "../../stores/documentStore";
import { useEditorStore, userViewModeCommands } from "../../stores/editorStore";
import { useThemeStore } from "../../stores/themeStore";
import { pluginRegistry } from "../../plugins";
import { highlightCommand } from "../../plugins/codemirror/highlightPlugin";
import { isPositionInFencedCode } from "../../plugins/codemirror/sourceTableDetection";
import { sourceTableTabKeymap } from "../../plugins/codemirror/sourceTableTabNav";
import { sourceTableArrowKeymap } from "../../plugins/codemirror/sourceTableArrowKeymap";
import { sourceTableExtensions } from "../../plugins/codemirror/sourceTableExtensions";
import { useSourceTablesWithheld } from "../../hooks/useSourceTablesWithheld";
import {
  consumePendingTableCell,
  locateCellInLines,
} from "../../utils/cursorSync/table";
import { linesFromText } from "../../plugins/codemirror/textLineSource";
import { restoreSourceScrollAnchor } from "../../utils/scrollAnchor/source";
import { loggingService } from "../../services/loggingService";
import { abandonIfStale, type HighlightRequest } from "../../utils/menuTargetToken";
import type { AppliedShortcuts } from "../../types/keyboardShortcuts";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** ⌘⇧H: each new value wraps the selection in ==…== once, if its token is current (D261). */
  highlightRequest?: HighlightRequest;
  /** D203: focus the view once it is created (a tab switch made while Source had focus). */
  focusOnMount?: boolean;
  appliedShortcuts?: AppliedShortcuts | null;
}

export function Editor({
  value,
  onChange,
  readOnly = false,
  highlightRequest,
  focusOnMount = false,
  appliedShortcuts = defaultAppliedShortcuts(isMacPlatform() ? "macos" : "linux"),
}: EditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const releaseAltGrGuardRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);
  const setEditorView = useEditorStore((state) => state.setEditorView);
  // D158: CodeMirror's base theme follows the app theme (see extensions/appTheme).
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  // ADR-0022: true when the active document's Source table verdict is
  // "withheld". A subscription (not a getState() read) because App's guard
  // effect records the verdict after this component mounts.
  const sourceTablesWithheld = useSourceTablesWithheld();
  const pluginExtensions = useMemo(
    () => withAppliedShortcuts(appliedShortcuts, () => pluginRegistry.getCodemirrorExtensions()),
    [appliedShortcuts],
  );
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
  const sourceDefaultKeys = useMemo(
    () => {
      const appOwned = new Set(["Shift-Mod-k", "Mod-i", "Mod-[", "Mod-]", "Mod-/"]);
      return keymap.of(defaultKeymap.filter((binding) =>
        !appOwned.has(binding.key ?? "") &&
        (isMacPlatform() || (binding.key !== "Ctrl-m" && binding.key !== "Mod-Alt-\\"))));
    },
    [],
  );

  // High-precedence keymap so Cmd+/ always cycles view modes (even when
  // CodeMirror has focus) and the line-comment shortcut moves to Cmd+Alt+/.
  // Without Prec.highest, basicSetup's defaultKeymap would bind Mod-/ to
  // toggleLineComment first. Cmd+/ is an explicit user command, so it cycles
  // through userViewModeCommands (user intent: persisted as lastViewMode,
  // ADR-0031 step 6) rather than the store's programmatic default.
  const viewModeKeymap = useMemo(
    () => {
      const key = appliedKey(appliedShortcuts, "viewCycleViewMode", isMacPlatform() ? "macos" : "linux");
      return Prec.highest(keymap.of([
        ...(key ? [{ key, run: () => { userViewModeCommands.cycle(); return true; } }] : []),
        ...(appliedShortcuts ? [{ key: "F6", run: () => { userViewModeCommands.cycle(); return true; } }] : []),
        { key: "Mod-Alt-/", run: toggleLineComment },
      ]));
    },
    [appliedShortcuts],
  );
  const activeSearchExtensions = useMemo(
    () => searchExtensionsFor(appliedShortcuts, isMacPlatform()),
    [appliedShortcuts],
  );
  const releaseReadyRef = useRef<(() => void) | null>(null);
  const readyDocumentId = useDocumentStore((state) => state.activeDocumentId);
  const readyGeneration = useMilkdownEditorStore((state) =>
    readyDocumentId ? (state.editorGenerations[readyDocumentId] ?? 0) : 0);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !readyDocumentId) return;
    releaseReadyRef.current?.();
    releaseReadyRef.current = registerReadyEditor({
      documentId: readyDocumentId, generation: readyGeneration, mode: "source", element: view.contentDOM,
      focus: () => { if (!view.dom.isConnected) return null; view.focus(); return view.contentDOM; },
    });
  }, [readyDocumentId, readyGeneration]);

  // Table Tab outranks CodeMirror's built-in indentWithTab, but falls through
  // outside tables (D40/D41, ADR-0046). Withheld documents omit the extension.
  const sourceTableTabKeymapExt = useMemo(
    () => Prec.high(keymap.of(sourceTableTabKeymap)),
    [],
  );
  const sourceTableArrowKeymapExt = useMemo(
    () => Prec.highest(keymap.of(sourceTableArrowKeymap(appliedShortcuts, isMacPlatform() ? "macos" : "linux"))),
    [appliedShortcuts],
  );

  // Memoize the full extensions array.
  // Dynamic compartments use stable `initial*` wrappers; their values are
  // synced from persisted prefs on every mount via reapplyEditorPrefs().
  const extensions = useMemo(
    () => [
      viewModeKeymap,
      markdownExtension,
      syntaxHighlightingExtension,
      ...activeSearchExtensions,
      pluginEventExtension,
      ...pluginExtensions,
      // Detection, Tab keymap, cell highlight, column-count linter — in this
      // order, or none of them when the document is withheld (ADR-0022).
      ...sourceTableExtensions({
        withheld: sourceTablesWithheld,
        tabKeymap: sourceTableTabKeymapExt,
      }),
      ...(!sourceTablesWithheld ? [sourceTableArrowKeymapExt] : []),
      // Dynamic compartments — reconfigured via applyEditorPref() and related helpers.
      // Initial values are defaults; reapplyEditorPrefs() syncs them to persisted prefs.
      initialWordWrap(true),
      initialTabSize(4),
      initialCloseBrackets(true),
      initialCodeTheme("default"),
      undoRedoKeymap,
      sourceDefaultKeys,
      EditorState.allowMultipleSelections.of(true),
    ],
    // The applied snapshot and table verdict both change these extensions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginEventExtension, pluginExtensions, undoRedoKeymap, sourceDefaultKeys, sourceTableTabKeymapExt, sourceTableArrowKeymapExt, viewModeKeymap, activeSearchExtensions, sourceTablesWithheld],
  );

  // A request whose document or editor has gone since it was made (a switch,
  // or this editor remounting with a request it already saw) changes nothing.
  useEffect(() => {
    if (highlightRequest === undefined) return;
    if (abandonIfStale(highlightRequest.token, "highlight", loggingService.generateActionId())) return;
    if (viewRef.current) {
      highlightCommand(viewRef.current);
    }
  }, [highlightRequest]);

  useEffect(() => {
    return () => {
      releaseReadyRef.current?.();
      releaseAltGrGuardRef.current?.();
      releaseAltGrGuardRef.current = null;
      releaseReadyRef.current = null;
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
        theme={sourceEditorTheme(resolvedTheme)}
        extensions={extensions}
        onChange={(nextValue) => {
          if (!readOnly) {
            onChange(nextValue);
          }
        }}
        onCreateEditor={(view) => {
          releaseAltGrGuardRef.current?.();
          releaseAltGrGuardRef.current = installAltGrGuard(view.contentDOM, isMacPlatform());
          viewRef.current = view;
          const readyDocumentId = useDocumentStore.getState().activeDocumentId;
          releaseReadyRef.current?.();
          if (readyDocumentId) {
            const generation = useMilkdownEditorStore.getState().editorGenerations[readyDocumentId] ?? 0;
            releaseReadyRef.current = registerReadyEditor({
              documentId: readyDocumentId, generation, mode: "source", element: view.contentDOM,
              focus: () => { if (!view.dom.isConnected) return null; view.focus(); return view.contentDOM; },
            });
          }
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
          if (focusOnMount) view.focus();
        }}
        editable={!readOnly}
        basicSetup={{
          defaultKeymap: false,
          lintKeymap: false,
          foldKeymap: false,
          searchKeymap: false,
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

// Keep the source keymap's cited line stable (tests/editor-owned-inventory.test.tsx).
import { registerReadyEditor } from "../../utils/focusActiveEditor";
import { useMilkdownEditorStore } from "../../stores/milkdownEditorStore";
