/**
 * editorPrefApply.ts
 *
 * Applies a single EditorConfig preference value either as a CSS variable on
 * :root (for font/layout settings) or as a CodeMirror Compartment dispatch
 * (for editor behavior settings).
 *
 * Compartment changes that arrive before the editor is mounted, or on a
 * re-mount, are handled by reapplyEditorPrefs(view) — call this from
 * Editor.tsx onCreateEditor after setEditorView().
 *
 * Used by:
 * - EditorSettings page on each user change (instant-apply)
 * - App.tsx on startup after getPreferences("app_hydrate") resolves (Decision 2A)
 * - Editor.tsx onCreateEditor to sync compartments with persisted prefs
 */
import type { EditorConfig } from "../../../types/preferences";
import {
  closeBracketsCompartment,
  codeThemeCompartment,
  tabSizeCompartment,
  wordWrapCompartment,
} from "../../Editor/extensions/dynamicExtensions";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { closeBrackets } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { useEditorStore } from "../../../stores/editorStore";
import type { CodeTheme, ContentWidth } from "../../../types/preferences";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function contentWidthToCss(width: ContentWidth): string {
  switch (width) {
    case "narrow": return "600px";
    case "medium": return "780px";
    case "wide":   return "900px";
    case "full":   return "none";
  }
}

export function fontFamilyToCss(family: string): string {
  switch (family) {
    case "serif": return "Georgia, 'Times New Roman', serif";
    case "mono":  return "'SF Mono', 'JetBrains Mono', ui-monospace, monospace";
    default:      return "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  }
}

// Clamp helpers to guard against corrupted persisted values
function clampFontSize(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 8), 72) : 16;
}
function clampLineHeight(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 10), 30) : 16;
}
function clampTabSize(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  // Valid tab sizes are 2, 4, or 8
  return n === 2 || n === 8 ? n : 4;
}

// ---------------------------------------------------------------------------
// Last-known compartment pref store
// ---------------------------------------------------------------------------

/**
 * Tracks the most recent value for each EditorConfig key that controls a
 * CodeMirror compartment.  Updated by applyEditorPref() and used by
 * reapplyEditorPrefs() to re-sync compartments after a mount or remount.
 */
const lastKnown: {
  tabSize: number;
  wordWrap: boolean;
} = {
  tabSize: 4,
  wordWrap: true,
};

/**
 * Re-apply all known compartment prefs to a freshly mounted EditorView.
 * Call this from Editor.tsx onCreateEditor immediately after setEditorView().
 */
export function reapplyEditorPrefs(view: EditorView): void {
  view.dispatch({
    effects: [
      tabSizeCompartment.reconfigure([
        EditorState.tabSize.of(lastKnown.tabSize),
        indentUnit.of(" ".repeat(lastKnown.tabSize)),
      ]),
      wordWrapCompartment.reconfigure(
        lastKnown.wordWrap ? EditorView.lineWrapping : [],
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Core apply function
// ---------------------------------------------------------------------------

/**
 * Applies a single EditorConfig key-value pair.
 * CSS-only changes (font, line-height, content-width) need no CodeMirror access.
 * Compartment changes get the EditorView from editorStore; if the view is not
 * yet mounted the value is persisted in lastKnown for replay on the next mount.
 */
export function applyEditorPref(
  key: keyof EditorConfig,
  value: EditorConfig[keyof EditorConfig],
): void {
  const root = document.documentElement;

  switch (key) {
    case "fontSize":
      root.style.setProperty("--editor-font-size", `${clampFontSize(value)}px`);
      return;

    case "lineHeightX10":
      root.style.setProperty(
        "--editor-line-height",
        String(clampLineHeight(value as number) / 10),
      );
      return;

    case "contentWidth":
      root.style.setProperty(
        "--editor-content-width",
        contentWidthToCss(value as ContentWidth),
      );
      return;

    case "fontFamily":
      root.style.setProperty(
        "--editor-font-family",
        fontFamilyToCss(value as string),
      );
      return;

    case "tabSize": {
      const size = clampTabSize(value);
      lastKnown.tabSize = size;
      const view = useEditorStore.getState().editorView;
      if (!view) return; // will be replayed in reapplyEditorPrefs on mount
      view.dispatch({
        effects: tabSizeCompartment.reconfigure([
          EditorState.tabSize.of(size),
          indentUnit.of(" ".repeat(size)),
        ]),
      });
      return;
    }

    case "wordWrap": {
      const wrap = value as boolean;
      lastKnown.wordWrap = wrap;
      const view = useEditorStore.getState().editorView;
      if (!view) return; // will be replayed in reapplyEditorPrefs on mount
      view.dispatch({
        effects: wordWrapCompartment.reconfigure(
          wrap ? EditorView.lineWrapping : [],
        ),
      });
      return;
    }
  }
}

/**
 * Applies a code theme change via the codeThemeCompartment.
 * Kept separate from applyEditorPref since CodeTheme is on AppearanceConfig, not EditorConfig.
 */
export function applyCodeTheme(theme: CodeTheme): void {
  const view = useEditorStore.getState().editorView;
  if (!view) return;
  view.dispatch({
    effects: codeThemeCompartment.reconfigure(
      theme === "oneDark"
        ? oneDark
        : syntaxHighlighting(defaultHighlightStyle),
    ),
  });
}

/**
 * Applies a closeBrackets change via the closeBracketsCompartment.
 * Kept separate since autoPair lives on MarkdownConfig, not EditorConfig.
 */
export function applyAutoPair(enabled: boolean): void {
  const view = useEditorStore.getState().editorView;
  if (!view) return;
  view.dispatch({
    effects: closeBracketsCompartment.reconfigure(
      enabled ? closeBrackets() : [],
    ),
  });
}
