/**
 * Purpose: Find `mod` items in Rust source, flag the `#[cfg(test)]` ones, and
 * splice the head's test modules into the base's production text for the replay's
 * restore of non-test paths (ADR-0149 d2: Rust inline tests make the restore a per-file
 * splice).
 *
 * Pipeline: lex (skipping comments, strings, raw strings, char literals, lifetimes) →
 * depth-0 items with their outer attributes → `mod name;` / `mod name { … }`.
 *
 * Key decisions:
 * - `#[cfg(test)]` and `#[cfg(all(test, …))]` mark a test module; `cfg(not(test))` (alone or
 *   as an `all` conjunct) marks production. Any other `cfg`, or a `cfg_attr` setting a path
 *   or cfg, that mentions `test` on a `mod` (e.g. `cfg(any(test, …))`) refuses: the
 *   boundary between test and production would be a guess.
 * - Test modules inside production inline modules are found and spliced within their
 *   module; one inside a function body refuses; one inside a test module is part of it.
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

function splitTop(list) {
  const parts = [];
  let depth = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) { parts.push(list.slice(from, i)); from = i + 1; }
  }
  return [...parts, list.slice(from)].filter(Boolean);
}

/** "test" when the attributes gate the item to test builds, else "prod"; throws when that is a guess. */
function gateOf(attrs, name) {
  let test = false;
  for (const { v } of attrs) {
    const all = /^cfg\(all\((.*)\)\)$/.exec(v);
    if (v === "cfg(test)" || (all && splitTop(all[1]).includes("test"))) { test = true; continue; }
    if (v === "cfg(not(test))" || (all && splitTop(all[1]).includes("not(test)"))) continue;
    if ((/^cfg\(/.test(v) || (/^cfg_attr\(/.test(v) && /path|cfg\(/.test(v))) && /\btest\b/.test(v)) {
      throw usageError(`Rust scan: mod ${name} has a cfg that mentions test but neither requires nor excludes it.`);
    }
  }
  return test ? "test" : "prod";
}
const pathAttr = (attrs) => { for (const a of attrs) { const m = /^path="((?:[^"\\]|\\.)*)"$/.exec(a.v); if (m) return m[1]; } return null; };

/**
 * Every `mod` item outside function bodies and test modules: {name, start, end, inline,
 * path, test, scope, bodyEnd}. `scope` names the enclosing inline modules. Throws on a
 * shape whose test boundary would be a guess.
 */
export function modItems(text) {
  const tokens = lex(text), items = [], stack = [];
  let attrs = [], pending = null;
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.t === "{") { stack.push(pending ?? { kind: "other" }); pending = null; attrs = []; continue; }
    if (token.t === "}") {
      const frame = stack.pop();
      if (!frame) throw usageError("Rust scan: unbalanced braces.");
      if (frame.item) { frame.item.end = token.end; frame.item.bodyEnd = token.i; }
      attrs = []; continue;
    }
    if (token.t === "attr") { attrs.push(token); continue; }
    let j = k;
    if (tokens[j].t === "ident" && tokens[j].v === "pub") {
      j++;
      if (tokens[j]?.t === "(") { while (tokens[j] && tokens[j].t !== ")") j++; j++; }
    }
    if (tokens[j]?.t === "ident" && tokens[j].v === "mod" && tokens[j + 1]?.t === "ident") {
      const name = tokens[j + 1].v, after = tokens[j + 2], inline = after?.t === "{";
      if (stack.some((frame) => frame.kind === "test")) { if (inline) pending = { kind: "test" }; }
      else {
        const test = gateOf(attrs, name) === "test", inOther = stack.some((frame) => frame.kind === "other");
        if (test && inOther) throw usageError(`Rust scan: #[cfg(test)] mod ${name} sits inside a non-module item.`);
        const item = { name, start: attrs.length ? attrs[0].i : token.i, end: after?.end ?? token.end, inline, path: pathAttr(attrs), test, scope: stack.filter((frame) => frame.kind === "mod").map((frame) => frame.name) };
        if (!inOther) items.push(item);
        if (inline) pending = { kind: test ? "test" : inOther ? "other" : "mod", name, item };
      }
      k = j + 1;
    }
    attrs = [];
  }
  if (stack.length) throw usageError("Rust scan: unbalanced braces.");
  return items;
}

/** The `#[cfg(test)]`-gated mod items, at any module depth. */
function cfgTestMods(text) { return modItems(text).filter((item) => item.test); }

/**
 * Base production text with every test module taken from the head, scope by scope: a
 * scope's base test items are replaced in place by the head's, or the head's are added at
 * the end of that scope (the file, or the enclosing module's body), which must exist in
 * the base.
 */
export function spliceTestMods(baseText, headText) {
  const baseAll = modItems(baseText), base = baseAll.filter((item) => item.test), head = cfgTestMods(headText);
  const key = (scope) => scope.join("::"), edits = [];
  for (const scope of new Set([...base, ...head].map((item) => key(item.scope)))) {
    const removed = base.filter((item) => key(item.scope) === scope), added = head.filter((item) => key(item.scope) === scope);
    const insertion = added.map((item) => `${headText.slice(item.start, item.end)}\n`).join("\n");
    if (removed.length) {
      removed.forEach((item, index) => edits.push({ start: item.start, end: baseText[item.end] === "\n" ? item.end + 1 : item.end, text: index === 0 ? insertion : "" }));
    } else if (scope === "") {
      edits.push({ start: baseText.length, end: baseText.length, text: `${baseText && !baseText.endsWith("\n") ? "\n" : ""}\n${insertion}` });
    } else {
      const owner = baseAll.find((item) => item.inline && !item.test && key([...item.scope, item.name]) === scope);
      if (!owner) throw usageError(`Rust splice: the base has no module ${scope} to hold the head's test module.`);
      const at = baseText.lastIndexOf("\n", owner.bodyEnd) + 1;
      edits.push({ start: at, end: at, text: insertion });
    }
  }
  let result = baseText;
  for (const edit of edits.sort((left, right) => right.start - left.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
