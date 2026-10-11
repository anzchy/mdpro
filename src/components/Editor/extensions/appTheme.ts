/**
 * @module components/Editor/extensions/appTheme
 * Purpose: the `theme` handed to `@uiw/react-codemirror` for the Source editor
 * (D158). It switches CodeMirror's base theme between its light and dark rule
 * sets to follow the app's resolved theme, and adds nothing else.
 *
 * Key decisions:
 *   - An Extension, never a string. `"light"` (the wrapper's default) appends
 *     @uiw's `#fff` theme and leaves `EditorView.darkTheme` false, so the
 *     `&light` rules of CodeMirror's base themes (view, search, autocomplete,
 *     lint) applied in the app's dark theme too. `"dark"` would impose oneDark;
 *     `"none"` alone keeps the light base rules.
 *   - Colours come from mdpro's `.theme-*` tokens in
 *     `src/styles/sections/editor-source.css`; the facet only picks which of
 *     CodeMirror's own defaults sit underneath what the app does not restyle
 *     (search matches, autocomplete selection, special characters).
 *   - Module-level constants, so the prop keeps its identity between renders.
 *     The oneDark code theme sets the facet itself, in either app theme.
 *
 * @coordinates-with src/components/Editor/Editor.tsx — passes the result as `theme`
 * @coordinates-with src/styles/sections/editor-source.css — the `.cm-theme` wrapper and chrome rules
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ResolvedTheme } from "../../../stores/themeStore";

const LIGHT: Extension = [];
const DARK: Extension = EditorView.darkTheme.of(true);

/** The Source editor's `theme` prop for the app's resolved theme. */
export function sourceEditorTheme(theme: ResolvedTheme): Extension {
  return theme === "dark" ? DARK : LIGHT;
}
