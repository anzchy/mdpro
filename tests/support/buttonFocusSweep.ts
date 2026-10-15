/**
 * @module buttonFocusSweep
 * Purpose: the D244 sweep's two scanners. `focusVisibleCompounds` collects,
 * for each compound selector in app CSS that carries `:focus-visible`, the
 * classes it names; `scanButtons` lists every `<button>` in a TSX source and
 * whether some such compound is satisfied by its static class names.
 *
 * Key decisions:
 * - Only the compound that carries `:focus-visible` counts: `.wrap .b:focus-visible`
 *   rings `.b`, not `.wrap`; `.c:has(.d:focus-visible)` rings `.d`.
 * - A button is ringed only when **every** class of one compound is among its
 *   tokens. Matching any single class let `is-active`, from
 *   `.table-context-menu-item.is-active:focus-visible`, ring the Settings rail
 *   (D244 verifier, 2026-10-15).
 * - Classes inside `:not(...)` are negations, not requirements, so they are
 *   dropped; a compound that names no class (`button:focus-visible`,
 *   `[name="close"]:focus-visible`) rings no button here.
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

/** The class lists of the `:focus-visible` compounds in `css`; compounds naming no class are left out. */
export function focusVisibleCompounds(css: string): string[][] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const compounds: string[][] = [];
  for (const block of text.matchAll(/([^{}]+)\{/g)) {
    for (const selector of block[1].split(",")) {
      // `:has(...)` holds its own compound: look inside it as well as outside.
      const parts = selector
        .replace(/:not\([^()]*\)/g, "")
        .replace(/[()]/g, " ")
        .split(/\s+|>|\+|~/);
      for (const part of parts) {
        if (!part.includes(":focus-visible")) continue;
        const classes = [...part.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]);
        if (classes.length > 0) compounds.push(classes);
      }
    }
  }
  return compounds;
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

export interface ScannedButton {
  /** Its first static class name, or `(unclassed)` when it has no `className`. */
  key: string;
  ringed: boolean;
}

/** Each `<button>` in `tsx`, in source order, and whether a compound in `compounds` rings it. */
export function scanButtons(tsx: string, compounds: string[][]): ScannedButton[] {
  const src = blankJsComments(tsx);
  const out: ScannedButton[] = [];
  for (const m of src.matchAll(/<button\b/g)) {
    const tag = openingTag(src, m.index ?? 0);
    const value = tag.match(/className=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/)?.[1];
    const tokens = new Set(value ? (value.match(/[A-Za-z][\w-]*/g) ?? []) : []);
    const ringed = compounds.some((c) => c.every((cls) => tokens.has(cls)));
    const key = value ? (value.match(/[a-z][\w-]*(?=[\s"`$])/)?.[0] ?? [...tokens][0]) : "(unclassed)";
    out.push({ key, ringed });
  }
  return out;
}
