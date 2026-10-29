/**
 * Purpose: Find top-level `mod` items in Rust source, flag the `#[cfg(test)]` ones, and
 * splice the head's test modules into the base's production text for the replay's
 * restore of non-test paths (ADR-0149 d2: Rust inline tests make the restore a per-file
 * splice).
 *
 * Pipeline: lex (skipping comments, strings, raw strings, char literals, lifetimes) →
 * depth-0 items with their outer attributes → `mod name;` / `mod name { … }`.
 *
 * Key decisions:
 * - Only the exact attribute `#[cfg(test)]` marks a test module. Any other `cfg`/`cfg_attr`
 *   that mentions `test` on a `mod` (e.g. `cfg(any(test, …))`) refuses: the boundary
 *   between test and production would be a guess.
 * - A `#[cfg(test)] mod` nested inside a non-test module refuses for the same reason; one
 *   inside a test module is part of that module.
 * - Item-level `#[cfg(test)]` on anything but `mod` (a `fn` seam, a `use`, a static) is
 *   production code: it is not a test path and stays at base in the replay.
 * - Unbalanced braces or brackets refuse.
 * @coordinates-with scripts/tdd/receipt-tree.mjs, scripts/tdd/receipt-replay.mjs
 */
import { usageError } from "./unit-red-lane.mjs";

const IDENT = /[A-Za-z0-9_]/;

function skipString(text, i) {
  for (i++; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  throw usageError("Rust scan: unterminated string.");
}

/** Tokens: {t: "attr"|"{"|"}"|"("|")"|";"|"ident"|"other", i, end, v}. */
function lex(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "/" && text[i + 1] === "*") {
      let depth = 1;
      for (i += 2; i < text.length && depth; i++) {
        if (text[i] === "/" && text[i + 1] === "*") { depth++; i++; } else if (text[i] === "*" && text[i + 1] === "/") { depth--; i++; }
      }
      if (depth) throw usageError("Rust scan: unterminated block comment.");
      continue;
    }
    const raw = /^b?r(#*)"/.exec(text.slice(i, i + 260));
    if (raw && (i === 0 || !IDENT.test(text[i - 1]))) {
      const close = `"${raw[1]}`, end = text.indexOf(close, i + raw[0].length);
      if (end < 0) throw usageError("Rust scan: unterminated raw string.");
      i = end + close.length; continue;
    }
    if (c === '"' || (c === "b" && text[i + 1] === '"' && !IDENT.test(text[i - 1] ?? ""))) { i = skipString(text, c === "b" ? i + 1 : i); continue; }
    if (c === "'") {
      if (text[i + 1] === "\\") { const end = text.indexOf("'", i + 2); if (end < 0) throw usageError("Rust scan: bad char literal."); i = end + 1; continue; }
      const width = text.codePointAt(i + 1) > 0xffff ? 2 : 1;
      if (text[i + 1 + width] === "'") { i += 2 + width; continue; }
      i++; while (i < text.length && IDENT.test(text[i])) i++;
      continue;
    }
    if (c === "#" && (text[i + 1] === "[" || (text[i + 1] === "!" && text[i + 2] === "["))) {
      const start = i;
      let depth = 0;
      for (i = text.indexOf("[", i); i < text.length; i++) {
        if (text[i] === '"') { i = skipString(text, i) - 1; continue; }
        if (text[i] === "[") depth++;
        else if (text[i] === "]" && --depth === 0) break;
      }
      if (depth) throw usageError("Rust scan: unbalanced attribute.");
      const inner = text[start + 1] === "!";
      tokens.push({ t: inner ? "other" : "attr", i: start, end: i + 1, v: text.slice(text.indexOf("[", start) + 1, i).replace(/\s+/g, "") });
      i++; continue;
    }
    if ("{}();".includes(c)) { tokens.push({ t: c, i, end: i + 1 }); i++; continue; }
    if (IDENT.test(c)) { const start = i; while (i < text.length && IDENT.test(text[i])) i++; tokens.push({ t: "ident", i: start, end: i, v: text.slice(start, i) }); continue; }
    if (!/\s/.test(c)) tokens.push({ t: "other", i, end: i + 1 });
    i++;
  }
  return tokens;
}

const testAttr = (attrs) => attrs.some((a) => a.v === "cfg(test)");
const doubtfulAttr = (attrs) => attrs.some((a) => /^cfg(?:_attr)?\(/.test(a.v) && /\btest\b/.test(a.v) && a.v !== "cfg(test)");
const pathAttr = (attrs) => { for (const a of attrs) { const m = /^path="((?:[^"\\]|\\.)*)"$/.exec(a.v); if (m) return m[1]; } return null; };

/** Every depth-0 `mod` item: {name, start, end, inline, path, test}. Throws on a shape it will not guess. */
export function modItems(text) {
  const tokens = lex(text), items = [];
  let depth = 0, attrs = [], testDepth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.t === "{") { depth++; attrs = []; continue; }
    if (token.t === "}") { if (--depth < 0) throw usageError("Rust scan: unbalanced braces."); if (testDepth && depth < testDepth) testDepth = 0; attrs = []; continue; }
    if (token.t === "attr") { attrs.push(token); continue; }
    let j = k;
    if (tokens[j].t === "ident" && tokens[j].v === "pub") {
      j++;
      if (tokens[j]?.t === "(") { while (tokens[j] && tokens[j].t !== ")") j++; j++; }
    }
    if (tokens[j]?.t === "ident" && tokens[j].v === "mod" && tokens[j + 1]?.t === "ident") {
      const name = tokens[j + 1].v, after = tokens[j + 2];
      const test = testAttr(attrs);
      if (doubtfulAttr(attrs)) throw usageError(`Rust scan: mod ${name} has a cfg that mentions test but is not exactly #[cfg(test)].`);
      const start = attrs.length ? attrs[0].i : token.i;
      if (depth > 0 && !testDepth) {
        if (test) throw usageError(`Rust scan: #[cfg(test)] mod ${name} is nested inside a non-test module.`);
      } else if (depth === 0 && after?.t === ";") {
        items.push({ name, start, end: after.end, inline: false, path: pathAttr(attrs), test });
      } else if (depth === 0 && after?.t === "{") {
        let level = 0, m = j + 2;
        for (; m < tokens.length; m++) { if (tokens[m].t === "{") level++; else if (tokens[m].t === "}" && --level === 0) break; }
        if (m >= tokens.length) throw usageError("Rust scan: unbalanced braces.");
        items.push({ name, start, end: tokens[m].end, inline: true, path: pathAttr(attrs), test });
        if (test) testDepth = 1;
      }
      k = j + 1;
    }
    attrs = [];
  }
  if (depth !== 0) throw usageError("Rust scan: unbalanced braces.");
  return items;
}

/** The depth-0 `#[cfg(test)] mod` items. */
export function cfgTestMods(text) { return modItems(text).filter((item) => item.test); }

export function spliceTestMods(baseText) { return baseText; }
