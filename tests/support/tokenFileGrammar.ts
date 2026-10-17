/**
 * @module tests/support/tokenFileGrammar
 * Purpose: the closed grammar the three token files must match before the
 * token readers (`exemptTokenDeclarations`, `tokenBlock`) may read them
 * (D278-FIX-3; user 「Let Codex weigh in」, Codex's A+ adopted by the
 * delegator). Those readers are regex based; this guard rejects every input
 * they could misread, so a misread throws instead of passing a gate.
 *
 * Key decisions:
 * - Lexing is a state machine over the raw text (comments, both quote
 *   types, parentheses, braces), not the regex comment blanker. It rejects
 *   unterminated strings and comments and unbalanced braces or parentheses.
 * - Rejected outright: `{ } ; /* *\/` inside a string, any backslash outside
 *   a comment, and `url(` in any form.
 * - Structure: plain rules with declarations only (no nesting), every
 *   declaration ending in `;`. At most one rule whose whole selector is the
 *   file's default block (`:root`, `.theme-light`, `.theme-dark`), holding
 *   only custom properties, plus `color-scheme` in a theme file; `tokenBlock`
 *   requires exactly one. Theme files allow no at-rule. `globals.css` allows
 *   one, `@media (prefers-reduced-motion: reduce)` holding one `:root` that
 *   re-times `--motion-*` tokens the default `:root` already declares, each
 *   to a time (Codex amendment, adopted).
 * - Not a CSS parser: anything outside this grammar is unsupported here,
 *   and widening it is a deliberate edit to this file.
 */

export type TokenFile = "globals" | "light" | "dark";

/** The default token block of each token file. */
export const DEFAULT_BLOCK: Record<TokenFile, string> = { globals: ":root", light: ".theme-light", dark: ".theme-dark" };

const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const TIME = /^\d+(\.\d+)?m?s$/;

interface Declaration {
  property: string;
  value: string;
  line: number;
}
interface Rule {
  selector: string;
  declarations: Declaration[];
  line: number;
}
interface AtRule {
  prelude: string;
  rules: Rule[];
  line: number;
}

class TokenFileSyntaxError extends Error {}

function fail(file: TokenFile, line: number, message: string): never {
  throw new TokenFileSyntaxError(`${file} token file, line ${line}: ${message}`);
}

/** The file's rules and at-rules, or a throw naming the first construct outside the grammar. */
function parse(css: string, file: TokenFile): { rules: Rule[]; atRules: AtRule[] } {
  const rules: Rule[] = [];
  const atRules: AtRule[] = [];
  let line = 1;
  let buffer = "";
  let parens = 0;
  let atRule: AtRule | null = null;
  let rule: Rule | null = null;
  const where = () => (rule ? "rule" : atRule ? "at-rule" : "top");

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "\n") line += 1;
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) fail(file, line, "unterminated comment");
      line += css.slice(i, end).split("\n").length - 1;
      buffer += " ";
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch && css[j] !== "\n") j += 1;
      if (j >= css.length || css[j] !== ch) fail(file, line, "unterminated string");
      const text = css.slice(i + 1, j);
      if (/[{};\\]|\/\*|\*\//.test(text)) {
        fail(file, line, text.includes("\\") ? "backslash in a string" : `string contains a structural character: ${css.slice(i, j + 1)}`);
      }
      if (/url\(/i.test(text)) fail(file, line, "url( in a string");
      buffer += css.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "\\") fail(file, line, "backslash outside a comment");
    if (ch === "(") {
      if (/url$/i.test(buffer)) fail(file, line, "url( is not allowed");
      parens += 1;
    } else if (ch === ")") {
      parens -= 1;
      if (parens < 0) fail(file, line, "unbalanced parentheses");
    }
    if (ch === "{" || ch === "}" || ch === ";") {
      if (parens !== 0) fail(file, line, "unbalanced parentheses");
      const text = buffer.replace(/\s+/g, " ").trim();
      buffer = "";
      if (ch === "{") {
        if (rule) fail(file, line, `nested rule \`${text}\` inside \`${rule.selector}\``);
        if (text.startsWith("@")) {
          if (atRule) fail(file, line, `nested at-rule \`${text}\``);
          atRule = { prelude: text, rules: [], line };
          atRules.push(atRule);
        } else {
          rule = { selector: text, declarations: [], line };
          (atRule ? atRule.rules : rules).push(rule);
        }
      } else if (ch === ";") {
        if (!rule) fail(file, line, `statement \`${text}\` outside a rule (at-rule or stray ;)`);
        const colon = text.indexOf(":");
        if (colon <= 0) fail(file, line, `not a declaration: \`${text}\``);
        rule.declarations.push({ property: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim(), line });
      } else {
        if (text) fail(file, line, `declaration without ; before }: \`${text}\``);
        if (rule) rule = null;
        else if (atRule) atRule = null;
        else fail(file, line, "unbalanced braces: } with no open block");
      }
      continue;
    }
    buffer += ch;
  }
  if (rule || atRule) fail(file, line, `unbalanced braces: ${where()} not closed`);
  if (buffer.trim()) fail(file, line, `trailing text \`${buffer.trim()}\``);
  return { rules, atRules };
}

/**
 * Throw unless `css` matches the token-file grammar for `file` (see the
 * module doc). `requireBlock` demands exactly one default block, as
 * `tokenBlock` does; the exemption allows none, which exempts nothing.
 */
export function validateTokenFile(css: string, file: TokenFile, options: { requireBlock?: boolean } = {}): void {
  const { rules, atRules } = parse(css, file);
  const block = DEFAULT_BLOCK[file];
  const defaults = rules.filter((r) => r.selector === block);
  if (defaults.length > 1) fail(file, defaults[1].line, `a second default block \`${block}\``);
  if (options.requireBlock && defaults.length === 0) fail(file, 1, `no default block \`${block}\``);
  for (const r of defaults) {
    for (const d of r.declarations) {
      const allowed = d.property.startsWith("--") || (file !== "globals" && d.property === "color-scheme");
      if (!allowed) fail(file, d.line, `\`${d.property}\` in \`${block}\` is not a token declaration`);
    }
  }
  if (file !== "globals" && atRules.length > 0) fail(file, atRules[0].line, `at-rule \`${atRules[0].prelude}\` in a theme file`);
  if (file === "globals") {
    if (atRules.length > 1) fail(file, atRules[1].line, `a second at-rule \`${atRules[1].prelude}\``);
    const media = atRules[0];
    if (media) checkReducedMotion(media, defaults[0], file);
  }
}

function checkReducedMotion(media: AtRule, root: Rule | undefined, file: TokenFile): void {
  if (media.prelude !== REDUCED_MOTION) fail(file, media.line, `at-rule \`${media.prelude}\` is not ${REDUCED_MOTION}`);
  if (media.rules.length !== 1 || media.rules[0].selector !== ":root") {
    fail(file, media.line, `${REDUCED_MOTION} must hold exactly one :root`);
  }
  const declared = new Set(root?.declarations.map((d) => d.property) ?? []);
  for (const d of media.rules[0].declarations) {
    if (!/^--motion-[\w-]+$/.test(d.property)) fail(file, d.line, `\`${d.property}\` in ${REDUCED_MOTION}: only --motion-* tokens`);
    if (!TIME.test(d.value)) fail(file, d.line, `\`${d.property}: ${d.value}\` in ${REDUCED_MOTION} is not a time`);
    if (!declared.has(d.property)) fail(file, d.line, `\`${d.property}\` is not declared in the default :root`);
  }
}

/** The token file a path under `src/` names, if any. */
export function tokenFileOfPath(rel: string): TokenFile | undefined {
  return ({ "styles/globals.css": "globals", "styles/themes/light.css": "light", "styles/themes/dark.css": "dark" } as const)[rel];
}

/** The token file whose default block is `selector`, if any. */
export function tokenFileOfBlock(selector: string): TokenFile | undefined {
  return (Object.keys(DEFAULT_BLOCK) as TokenFile[]).find((f) => DEFAULT_BLOCK[f] === selector);
}
