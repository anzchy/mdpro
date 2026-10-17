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
 *   declaration ending in `;`, none empty, none `!important`, none declared
 *   twice in one rule, custom-property names within `[\w-]` (D278-FIX-4).
 *   In a file with its default block, which rules may exist beside it is a
 *   closed allowlist, not a selector match (D278-FIX-5; a name match missed
 *   `[class]`, `:Root`, `body` and the like): a theme file holds only its
 *   default block; `globals.css` may hold ordinary rules, but sets custom
 *   properties only in `:root`, the reduced-motion `:root`, and exactly
 *   `body.tauri-macos` with the three `--traffic-lights-*` tokens. So no rule
 *   overrides a token that `tokenBlock` does not see. A snippet without the
 *   block exempts nothing, so its rules are only scanned.
 *   At most one rule whose whole selector is the
 *   file's default block (`:root`, `.theme-light`, `.theme-dark`), holding
 *   only custom properties, plus `color-scheme` in a theme file; `tokenBlock`
 *   requires exactly one. Theme files allow no at-rule. `globals.css` allows
 *   one, `@media (prefers-reduced-motion: reduce)` holding one `:root` that
 *   re-times `--motion-*` tokens the default `:root` already declares, each
 *   to a time (Codex amendment, adopted), and comes after the default
 *   `:root` (D278-FIX-4).
 * - Not a CSS parser: anything outside this grammar is unsupported here,
 *   and widening it is a deliberate edit to this file.
 */

export type TokenFile = "globals" | "light" | "dark";

/** The default token block of each token file. */
export const DEFAULT_BLOCK: Record<TokenFile, string> = { globals: ":root", light: ".theme-light", dark: ".theme-dark" };

const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const TIME = /^\d+(\.\d+)?m?s$/;
/** The one rule besides `:root` that may set custom properties in globals.css, and the ones it may set. */
const TRAFFIC_LIGHTS_RULE = "body.tauri-macos";
const TRAFFIC_LIGHTS = new Set(["--traffic-lights-end", "--traffic-lights-clearance", "--traffic-lights-clearance-main"]);

/** A declaration; `start` and `end` are the source offsets of its first character and its `;`. */
export interface Declaration {
  property: string;
  value: string;
  line: number;
  start: number;
  end: number;
}
/** A rule; `open` and `close` are the source offsets of its braces. */
export interface Rule {
  selector: string;
  declarations: Declaration[];
  line: number;
  open: number;
  close: number;
}
interface AtRule {
  prelude: string;
  rules: Rule[];
  line: number;
  open: number;
}

/** What the readers may read: the default block, and in globals.css the reduced-motion `:root`. */
export interface TokenFileBlocks {
  block?: Rule;
  motion?: Rule;
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
  let start = -1;
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
      if (start < 0) start = i;
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
      const from = start;
      buffer = "";
      start = -1;
      if (ch === "{") {
        if (rule) fail(file, line, `nested rule \`${text}\` inside \`${rule.selector}\``);
        if (text.startsWith("@")) {
          if (atRule) fail(file, line, `nested at-rule \`${text}\``);
          atRule = { prelude: text, rules: [], line, open: i };
          atRules.push(atRule);
        } else {
          rule = { selector: text, declarations: [], line, open: i, close: -1 };
          (atRule ? atRule.rules : rules).push(rule);
        }
      } else if (ch === ";") {
        if (!rule) fail(file, line, `statement \`${text}\` outside a rule (at-rule or stray ;)`);
        const colon = text.indexOf(":");
        if (colon <= 0) fail(file, line, `not a declaration: \`${text}\``);
        const property = text.slice(0, colon).trim();
        const value = text.slice(colon + 1).trim();
        if (property.startsWith("--") && !/^--[\w-]+$/.test(property)) fail(file, line, `custom-property name \`${property}\` is outside [\\w-]`);
        if (!value) fail(file, line, `\`${property}\` has an empty value`);
        if (/!\s*important/i.test(value)) fail(file, line, `\`${property}\` is !important`);
        if (rule.declarations.some((d) => d.property === property)) fail(file, line, `\`${property}\` declared twice in \`${rule.selector}\``);
        rule.declarations.push({ property, value, line, start: from, end: i });
      } else {
        if (text) fail(file, line, `declaration without ; before }: \`${text}\``);
        if (rule) {
          rule.close = i;
          rule = null;
        }
        else if (atRule) atRule = null;
        else fail(file, line, "unbalanced braces: } with no open block");
      }
      continue;
    }
    if (start < 0 && !/\s/.test(ch)) start = i;
    buffer += ch;
  }
  if (rule || atRule) fail(file, line, `unbalanced braces: ${where()} not closed`);
  if (buffer.trim()) fail(file, line, `trailing text \`${buffer.trim()}\``);
  return { rules, atRules };
}

/**
 * Throw unless `css` matches the token-file grammar for `file` (see the
 * module doc), and return the blocks the readers may read, so they read the
 * one parse rather than finding the block again (D278-FIX-4).
 * `requireBlock` demands exactly one default block, as `tokenBlock` does;
 * the exemption allows none, which exempts nothing.
 */
export function validateTokenFile(css: string, file: TokenFile, options: { requireBlock?: boolean } = {}): TokenFileBlocks {
  const { rules, atRules } = parse(css, file);
  const block = DEFAULT_BLOCK[file];
  const defaults = rules.filter((r) => r.selector === block);
  if (defaults.length > 1) fail(file, defaults[1].line, `a second default block \`${block}\``);
  if (options.requireBlock && defaults.length === 0) fail(file, 1, `no default block \`${block}\``);
  if (defaults.length > 0) checkAllowlist(rules, block, file);
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
    if (media) {
      if (!defaults[0] || media.open < defaults[0].open) fail(file, media.line, `${REDUCED_MOTION} before the default block \`${block}\``);
      checkReducedMotion(media, defaults[0], file);
      return { block: defaults[0], motion: media.rules[0] };
    }
  }
  return { block: defaults[0] };
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

/** Every top-level rule besides the default block must be on the allowlist (D278-FIX-5). */
function checkAllowlist(rules: Rule[], block: string, file: TokenFile): void {
  for (const r of rules) {
    if (r.selector === block) continue;
    if (file !== "globals") fail(file, r.line, `\`${r.selector}\` is outside the token blocks; a theme file holds only its default block \`${block}\``);
    for (const d of r.declarations) {
      if (!d.property.startsWith("--")) continue;
      if (r.selector === TRAFFIC_LIGHTS_RULE && TRAFFIC_LIGHTS.has(d.property)) continue;
      fail(file, d.line, `\`${r.selector}\` sets \`${d.property}\` outside the token blocks; only \`${block}\`, the reduced-motion :root and ${TRAFFIC_LIGHTS_RULE}'s --traffic-lights-* may`);
    }
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
