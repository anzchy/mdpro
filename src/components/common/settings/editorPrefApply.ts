/**
 * editorPrefApply.ts
 *
 * Applies a single EditorConfig preference value either as a CSS variable on
 * :root (for font/layout settings) or as a CodeMirror Compartment dispatch
 * (for editor behavior settings).
 *
 * Used by:
 * - EditorSettings page on each user change (instant-apply)
 * - App.tsx on startup after getPreferences() resolves (Decision 2A)
 */
import type { EditorConfig } from "../../../types/preferences";
import {
  closeBracketsCompartment,
  codeThemeCompartment,
  tabSizeCompartment,
  wordWrapCompartment,
} from "../../Editor/extensions/dynamicExtensions";
import { EditorView } from "@codemirror/view";
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

// ---------------------------------------------------------------------------
// Core apply function
// ---------------------------------------------------------------------------

/**
 * Applies a single EditorConfig key-value pair.
 * CSS-only changes (font, line-height, content-width) need no CodeMirror access.
 * Compartment changes get the EditorView from editorStore.
 */
export function applyEditorPref(
  key: keyof EditorConfig,
  value: EditorConfig[keyof EditorConfig],
): void {
  const root = document.documentElement;

  switch (key) {
    case "fontSize":
      root.style.setProperty("--editor-font-size", `${value as number}px`);
      return;

    case "lineHeightX10":
      root.style.setProperty(
        "--editor-line-height",
        String((value as number) / 10),
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
      const view = useEditorStore.getState().editorView;
      if (!view) return;
      view.dispatch({
        effects: tabSizeCompartment.reconfigure(
          indentUnit.of(" ".repeat(value as number)),
        ),
      });
      return;
    }

    case "wordWrap": {
      const view = useEditorStore.getState().editorView;
      if (!view) return;
      view.dispatch({
        effects: wordWrapCompartment.reconfigure(
          (value as boolean) ? EditorView.lineWrapping : [],
        ),
      });
      return;
    }

    // No default arm — TypeScript exhaustiveness handles unknown keys at compile time.
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
