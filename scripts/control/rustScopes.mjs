/**
 * Purpose: Derive, for every offset of a Rust source file, the scope the
 * persistence-roots scanner reports a `dirs::` site under: `test` inside the
 * brace extent of an inline test-gated `mod`, `production-other-os` inside
 * the extent of an item or block whose `cfg(...)` is false on macOS, else
 * `production`. Consumed by `persistenceRoots.mjs` (ADR-0047 WI-002 WI-7).
 *
 * Pipeline: comment-blanked text (from `commentBlanker.mjs`) → a structural
 * copy with string and char literal bodies blanked too (same length) → find
 * `#[cfg(...)]` attributes in the structural copy, read their predicate from
 * the comment-blanked text (string values such as `"windows"` intact) → the
 * attributed item's extent → regions.
 *
 * Key decisions:
 * - cfg evaluation is three-valued. On this target `target_os = "macos"`,
 *   `unix` and `target_family = "unix"` are true, any other `target_os` /
 *   `target_family` and `windows` are false, and anything else (`test`,
 *   `feature = …`, `debug_assertions`) is unknown. Only a predicate that is
 *   definitely false makes a region `production-other-os`, so an unknown
 *   never hides a production site.
 * - A `mod` is a test module when its cfg is false with `test` off and not
 *   false with `test` on (`cfg(test)`, `cfg(all(test, feature = …))`). An
 *   out-of-line `mod x;` has no extent and changes nothing.
 * - An item's extent runs from the end of its attributes to the first `;` or
 *   `,` at nesting depth 0, or to the `}` matching the first depth-0 `{`, or
 *   to the enclosing block's `}`. Braces inside string and char literals are
 *   blanked first, so they cannot end an extent early.
 *
 * @module scripts/control/rustScopes
 * @coordinates-with scripts/control/persistenceRoots.mjs (scopeAt)
 * @coordinates-with scripts/control/commentBlanker.mjs (input text)
 */

const RAW_OPEN = /^b?r(#*)"/;
const CHAR_LITERAL = /^b?'(?:\\u\{[0-9a-fA-F]+\}|\\.|[^\\'\n])'/;
const OPENERS = { "(": ")", "[": "]", "{": "}" };

/**
 * Same-length copy of comment-blanked `text` with every string and char
 * literal body replaced by spaces (newlines kept).
 * @param {string} text
 */
export function blankLiterals(text) {
  const out = text.split("");
  const blank = (/** @type {number} */ a, /** @type {number} */ b) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const prevWord = /\w/.test(text[i - 1] ?? "");
    const raw = prevWord ? null : RAW_OPEN.exec(text.slice(i, i + 260));
    const ch = prevWord ? null : CHAR_LITERAL.exec(text.slice(i, i + 16));
    if (raw) {
      const close = text.indexOf(`"${raw[1]}`, i + raw[0].length);
      const end = close === -1 ? text.length : close + raw[1].length + 1;
      blank(i, end);
      i = end;
    } else if (ch) {
      blank(i, i + ch[0].length);
      i += ch[0].length;
    } else if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      blank(i, j + 1);
      i = j + 1;
    } else i++;
  }
  return out.join("");
}

/**
 * Index just past the bracket that closes the one opened at `open`.
 * @param {string} s structural text
 * @param {number} open
 */
export function closeOf(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] in OPENERS) depth++;
    else if (s[j] === ")" || s[j] === "]" || s[j] === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return s.length;
}

/**
 * Parse a cfg predicate into a tree: `{ all|any: [...] }`, `{ not: p }`,
 * `{ key, value }` or `{ key }`.
 * @param {string} src
 */
function parsePredicate(src) {
  const tokens = src.match(/"(?:\\.|[^"\\])*"|[A-Za-z_]\w*|[(),=]/g) ?? [];
  let k = 0;
  /** @returns {any} */
  const expr = () => {
    const name = tokens[k++];
    if ((name === "all" || name === "any" || name === "not") && tokens[k] === "(") {
      k++;
      const args = [];
      while (k < tokens.length && tokens[k] !== ")") {
        args.push(expr());
        if (tokens[k] === ",") k++;
      }
      k++;
      return name === "not" ? { not: args[0] ?? { key: "?" } } : { [name]: args };
    }
    if (tokens[k] === "=") {
      k++;
      return { key: name, value: String(tokens[k++] ?? "").slice(1, -1) };
    }
    return { key: name };
  };
  return expr();
}

/**
 * Three-valued value of a cfg predicate on macOS: true, false or null.
 * @param {any} p
 * @param {boolean} test whether `cfg(test)` is on
 * @returns {boolean | null}
 */
function evaluate(p, test) {
  if (p.all) {
    const vs = p.all.map((/** @type {any} */ q) => evaluate(q, test));
    return vs.includes(false) ? false : vs.includes(null) ? null : true;
  }
  if (p.any) {
    const vs = p.any.map((/** @type {any} */ q) => evaluate(q, test));
    return vs.includes(true) ? true : vs.includes(null) ? null : false;
  }
  if (p.not) {
    const v = evaluate(p.not, test);
    return v === null ? null : !v;
  }
  if (p.key === "target_os") return p.value === "macos";
  if (p.key === "target_family") return p.value === "unix";
  if (p.key === "unix") return true;
  if (p.key === "windows") return false;
  if (p.key === "test" && p.value === undefined) return test;
  return null;
}

/**
 * End of the item that starts at `from` (attributes already skipped).
 * @param {string} s structural text
 * @param {number} from
 */
function itemEnd(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === ";" || c === ",") return j;
    if (c === "}") return j;
    if (c === "{") return closeOf(s, j);
    if (c === "(" || c === "[") j = closeOf(s, j) - 1;
  }
  return s.length;
}

/**
 * Test and other-OS regions of one file, as `[start, end)` offset pairs.
 * @param {string} code comment-blanked text (strings intact)
 * @returns {{ test: [number, number][], otherOs: [number, number][] }}
 */
export function regions(code) {
  const s = blankLiterals(code);
  /** @type {[number, number][]} */ const test = [];
  /** @type {[number, number][]} */ const otherOs = [];
  for (const m of s.matchAll(/#\s*\[\s*cfg\s*\(/g)) {
    const attrOpen = s.indexOf("[", m.index);
    const attrEnd = closeOf(s, attrOpen);
    const predOpen = s.indexOf("(", attrOpen);
    const pred = parsePredicate(code.slice(predOpen + 1, closeOf(s, predOpen) - 1));
    let from = attrEnd;
    for (;;) {
      const next = /^\s*#\s*\[/.exec(s.slice(from));
      if (!next) break;
      from = closeOf(s, from + next[0].length - 1);
    }
    const end = itemEnd(s, from);
    const mod = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+\w+\s*\{/.exec(s.slice(from));
    if (mod && evaluate(pred, false) === false && evaluate(pred, true) !== false) test.push([from, end]);
    else if (evaluate(pred, true) === false && evaluate(pred, false) === false) otherOs.push([from, end]);
  }
  return { test, otherOs };
}
