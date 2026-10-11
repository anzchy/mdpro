/**
 * @module tests/support/cssRules
 * Purpose: shared CSS inspection helpers for the Source-editor styling tests
 * (D154 selection highlight, D158 editor theme). Extracted from
 * `tests/d154-source-selection-highlight.test.ts` so the two files do not keep
 * diverging copies.
 *
 * Key decisions:
 *   - A flat rule parser, not a CSS engine: enough for `editor-source.css` and
 *     the CSS CodeMirror's style-mod generates (no nesting, no at-rules that
 *     wrap the rules these tests read).
 *   - Specificity is the [ids, classes/attributes/pseudo-classes, types] triple,
 *     sufficient for the selectors in play (no :is()/:where()/:not() argument
 *     weighting).
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */

export interface CssRule {
  selectors: string[];
  decls: Map<string, string>;
}

/** Flat rule parser — comments stripped, one entry per `selectors { decls }` block. */
export function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const selectors = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const decls = new Map<string, string>();
    for (const part of m[2].split(";")) {
      const idx = part.indexOf(":");
      if (idx < 0) continue;
      decls.set(part.slice(0, idx).trim().toLowerCase(), part.slice(idx + 1).trim());
    }
    rules.push({ selectors, decls });
  }
  return rules;
}

export type Specificity = [number, number, number];

/** [ids, classes/attributes/pseudo-classes, types] — sufficient for these selectors. */
export function specificity(selector: string): Specificity {
  const s = selector.replace(/::[\w-]+/g, "");
  const ids = (s.match(/#[^\s.#:>+~[]+/g) ?? []).length;
  const classes =
    (s.match(/\.[^\s.#:>+~[]+/g) ?? []).length +
    (s.match(/\[[^\]]*\]/g) ?? []).length +
    (s.match(/:[\w-]+/g) ?? []).length;
  const types = (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes, types];
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function background(rule: CssRule): string | undefined {
  return rule.decls.get("background-color") ?? rule.decls.get("background");
}

/** The compound selector that names the element a rule styles. */
export const lastCompound = (selector: string): string =>
  selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? "";

/** Every CSS rule CodeMirror injected into the document for the mounted views. */
export function codemirrorCss(): string {
  const parts: string[] = [];
  document.querySelectorAll("style").forEach((el) => parts.push(el.textContent ?? ""));
  const adopted =
    (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
  for (const sheet of adopted) for (const r of Array.from(sheet.cssRules)) parts.push(r.cssText);
  return parts.join("\n");
}
