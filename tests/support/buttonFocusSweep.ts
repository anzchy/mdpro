/**
 * @module buttonFocusSweep
 * Purpose: the D244 sweep's two scanners. `focusVisibleClasses` collects the
 * classes that a `:focus-visible` compound selector names in app CSS;
 * `unringedButtons` lists the `<button>` elements in a TSX source none of
 * whose static class names is in that set.
 *
 * Key decisions:
 * - Only the compound that carries `:focus-visible` counts: `.wrap .b:focus-visible`
 *   rings `.b`, not `.wrap`; `.c:has(.d:focus-visible)` rings `.d`.
 * - A button's classes are every identifier-like token in its `className`
 *   value, so template literals and conditionals count their static parts.
 * - Comments are blanked first, so a `<button>` in a doc comment is not a button.
 *
 * @coordinates-with tests/d244-button-focus-visible.test.ts
 */

/** Blank JS/TS comments, keeping offsets. */
function blankJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

/** The classes named by a `:focus-visible` compound in `css` (comments blanked by the caller or here). */
export function focusVisibleClasses(css: string): Set<string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const classes = new Set<string>();
  for (const block of text.matchAll(/([^{}]+)\{/g)) {
    for (const selector of block[1].split(",")) {
      // `:has(...)` holds its own compound: look inside it as well as outside.
      const parts = selector.replace(/[()]/g, " ").split(/\s+|>|\+|~/);
      for (const part of parts) {
        if (!part.includes(":focus-visible")) continue;
        for (const m of part.matchAll(/\.([A-Za-z][\w-]*)/g)) classes.add(m[1]);
      }
    }
  }
  return classes;
}

/** The opening `<button …>` tag starting at `start`, braces balanced. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/**
 * Each `<button>` in `tsx` that reaches no class in `ringed`, in source order:
 * its first static class name, or `(unclassed)` when it has no `className`.
 */
export function unringedButtons(tsx: string, ringed: Set<string>): string[] {
  const src = blankJsComments(tsx);
  const out: string[] = [];
  for (const m of src.matchAll(/<button\b/g)) {
    const tag = openingTag(src, m.index ?? 0);
    const value = tag.match(/className=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/)?.[1];
    const tokens = value ? (value.match(/[A-Za-z][\w-]*/g) ?? []) : [];
    if (tokens.some((t) => ringed.has(t))) continue;
    out.push(value ? (value.match(/[a-z][\w-]*(?=[\s"`$])/)?.[0] ?? tokens[0]) : "(unclassed)");
  }
  return out;
}
