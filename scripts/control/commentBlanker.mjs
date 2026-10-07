/**
 * Purpose: Replace the comments of a JS/TS, Rust or CSS source text with
 * spaces, keeping every newline and every string literal, so the result has
 * the same length and the same line numbers as the input. `buildInputsGuard`
 * runs its reference patterns over this copy, so a path mentioned in a
 * comment is never reported. Consumed by `buildInputsGuard.mjs` (WI-5) and
 * `tests/control-build-inputs-guard-forms.test.ts` through it.
 *
 * Key decisions:
 * - Strings are skipped, not blanked: a ref lives inside a string. JS: `"`,
 *   `'` and template literals (a template may span lines; the others stop at
 *   a newline). Rust: `"` strings may span lines; char literals (`'a'`,
 *   `'\n'`, `'\u{1F600}'`) are skipped so a lifetime tick (`'a`) does not open
 *   a string; raw strings `r"…"`, `r#"…"#`, byte raw `br"…"`, `br#"…"#` end at
 *   the matching quote-plus-hashes with no escapes (WI-17 fix). CSS has no
 *   `//` comments.
 * - Rust block comments nest; JS and CSS block comments do not.
 * - A raw-string opener is only recognised when the preceding character is not
 *   a word character, so `bar"…"` and `for"…"` are not misread.
 *
 * @module scripts/control/commentBlanker
 * @coordinates-with scripts/control/buildInputsGuard.mjs (codeRefs)
 */

/** Longest opener this looks for: `br` + hashes + `"`. */
const RAW_OPEN_WINDOW = 260;
const RAW_OPEN = /^b?r(#*)"/;
const CHAR_LITERAL = /^'(?:\\u\{[0-9a-fA-F]+\}|\\.|[^\\'\n])'/;

/**
 * Index just past the Rust raw string that starts at `i`, or -1 when no raw
 * string opens there. An unterminated raw string runs to the end of the text.
 * @param {string} text
 * @param {number} i
 */
function rawStringEnd(text, i) {
  const c = text[i];
  if ((c !== "r" && c !== "b") || /\w/.test(text[i - 1] ?? "")) return -1;
  const open = RAW_OPEN.exec(text.slice(i, i + RAW_OPEN_WINDOW));
  if (open === null) return -1;
  const hashes = open[1];
  const close = text.indexOf(`"${hashes}`, i + open[0].length);
  return close === -1 ? text.length : close + hashes.length + 1;
}

/**
 * Index just past the block comment that starts at `i` (`/*` already seen).
 * @param {string} text
 * @param {number} i
 * @param {boolean} nests whether `/*` inside the comment opens another level (Rust)
 */
function blockCommentEnd(text, i, nests) {
  const n = text.length;
  let depth = 1;
  let j = i + 2;
  while (j < n && depth > 0) {
    const two = text.slice(j, j + 2);
    if (two === "*/") {
      depth--;
      j += 2;
    } else if (two === "/*" && nests) {
      depth++;
      j += 2;
    } else j++;
  }
  return j;
}

/**
 * Index just past the plain string literal opened by `quote` at `i`.
 * @param {string} text
 * @param {number} i
 * @param {string} quote `"`, `'` or `` ` ``
 * @param {"js" | "rust" | "css"} lang
 */
function stringEnd(text, i, quote, lang) {
  const n = text.length;
  const multiline = quote === "`" || lang === "rust";
  let j = i + 1;
  while (j < n && text[j] !== quote) {
    if (text[j] === "\\") j++;
    else if (text[j] === "\n" && !multiline) break;
    j++;
  }
  return j + 1;
}

/**
 * Same-length copy of `text` with comments replaced by spaces (newlines kept)
 * and string literals left intact, so offsets and lines are unchanged.
 * @param {string} text
 * @param {"js" | "rust" | "css"} lang
 * @returns {string}
 */
export function blankComments(text, lang) {
  const out = text.split("");
  const blank = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/" && lang !== "css") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const j = blockCommentEnd(text, i, lang === "rust");
      blank(i, j);
      i = j;
    } else if (lang === "rust" && rawStringEnd(text, i) !== -1) {
      i = rawStringEnd(text, i);
    } else if (lang === "rust" && c === "'") {
      const ch = CHAR_LITERAL.exec(text.slice(i, i + 16));
      i += ch ? ch[0].length : 1; // a char literal, or a lifetime tick
    } else if (c === '"' || c === "'" || (c === "`" && lang === "js")) {
      i = stringEnd(text, i, c, lang);
    } else i++;
  }
  return out.join("");
}
