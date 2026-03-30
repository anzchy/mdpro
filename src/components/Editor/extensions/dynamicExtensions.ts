/**
 * Dynamic CodeMirror Compartments for live preference reconfiguration.
 * Each Compartment wraps an extension that can be hot-swapped without
 * destroying and recreating the editor.
 *
 * Usage: call compartment.reconfigure(newExtension) on the EditorView
 * to change the extension at runtime.
 */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { closeBrackets } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";

export const wordWrapCompartment = new Compartment();
export const tabSizeCompartment = new Compartment();
export const closeBracketsCompartment = new Compartment();
export const codeThemeCompartment = new Compartment();

/** Returns the initial extension for wordWrapCompartment based on the saved pref */
export function initialWordWrap(enabled: boolean) {
  return wordWrapCompartment.of(enabled ? EditorView.lineWrapping : []);
}

/** Returns the initial extension for tabSizeCompartment based on the saved pref.
 *  Sets both the display tab width (EditorState.tabSize) and the indent insertion
 *  unit (indentUnit) so that Tab key and tab display are consistent. */
export function initialTabSize(size: number) {
  return tabSizeCompartment.of([
    EditorState.tabSize.of(size),
    indentUnit.of(" ".repeat(size)),
  ]);
}

/** Returns the initial extension for closeBracketsCompartment based on the saved pref */
export function initialCloseBrackets(enabled: boolean) {
  return closeBracketsCompartment.of(enabled ? closeBrackets() : []);
}

/** Returns the initial extension for codeThemeCompartment based on the saved pref */
export function initialCodeTheme(theme: "default" | "oneDark") {
  return codeThemeCompartment.of(
    theme === "oneDark"
      ? oneDark
      : syntaxHighlighting(defaultHighlightStyle),
  );
}
