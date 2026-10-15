/**
 * Indentation-aware block extractor for GitHub workflow YAML (D76-WI-6, plan
 * D-2: no YAML dependency). It understands the subset `release.yml` uses —
 * block maps, indented `- ` sequences, `|`/`>` block scalars, flow sequences
 * of plain scalars, `#` comments and quoted keys — and throws on anything else
 * it meets (flow maps, anchors/aliases, tabs, duplicate keys, compact
 * sequences at the parent's indentation) rather than misparsing it.
 *
 * Every function takes a text block and works at that block's own base
 * indentation (the smallest indentation of a non-blank, non-comment line), so
 * a body returned by one call is the input to the next. Pinned by
 * tests/tooling/release-workflow-blocks.test.ts (W0).
 */
export interface Entry {
  /** Inline value after `key:`, unquoted and without a trailing comment; null when absent or a block scalar. */
  inline: string | null;
  /** The child lines (or block-scalar content), dedented; "" when there are none. */
  body: string;
}

const KEY_LINE = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_][A-Za-z0-9_.-]*))\s*:(?:\s+(.*)|\s*)$/;
const BLOCK_SCALAR = /^[|>][-+]?$/;

const split = (text: string | null) => (text ?? "").split(/\r?\n/);
const isNeutral = (l: string) => l.trim() === "" || l.trimStart().startsWith("#");
const indentOf = (l: string) => {
  const lead = /^[ \t]*/.exec(l)?.[0] ?? "";
  if (lead.includes("\t")) throw new Error(`tab indentation is not supported: ${JSON.stringify(l)}`);
  return lead.length;
};

function baseIndent(lines: string[]): number {
  let min = Infinity;
  for (const l of lines) if (!isNeutral(l)) min = Math.min(min, indentOf(l));
  return min === Infinity ? 0 : min;
}

function dedent(lines: string[]): string {
  const trimmed = [...lines];
  while (trimmed.length && isNeutral(trimmed[trimmed.length - 1])) trimmed.pop();
  while (trimmed.length && trimmed[0].trim() === "") trimmed.shift();
  let min = Infinity;
  for (const l of trimmed) if (l.trim() !== "") min = Math.min(min, indentOf(l));
  if (min === Infinity) return "";
  return trimmed.map((l) => (l.trim() === "" ? "" : l.slice(min))).join("\n");
}

/** Unquote a scalar and drop a trailing ` # comment` outside quotes. */
function cleanScalar(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let quote: string | null = null;
  let end = raw.length;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
      end = i;
      break;
    }
  }
  const v = raw.slice(0, end).trim();
  if (v === "") return null;
  if (v.length >= 2 && v[0] === "'" && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.length >= 2 && v[0] === '"' && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

function parseKeyLine(content: string): { key: string; rest: string | undefined } | null {
  const m = KEY_LINE.exec(content);
  return m ? { key: m[1] ?? m[2] ?? m[3], rest: m[4] } : null;
}

function checkInline(key: string, inline: string | null) {
  if (inline === null) return;
  if (inline.startsWith("{")) throw new Error(`flow mapping is not supported at ${key}: ${inline}`);
  if (/^[&*]/.test(inline)) throw new Error(`anchors and aliases are not supported at ${key}: ${inline}`);
}

/** The base-level entry `key`, or null. Throws on a duplicate or an unsupported construct. */
export function entry(text: string | null, key: string): Entry | null {
  const lines = split(text);
  const base = baseIndent(lines);
  let found: Entry | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isNeutral(l) || indentOf(l) !== base) continue;
    const m = parseKeyLine(l.slice(base));
    if (!m || m.key !== key) continue;
    if (found) throw new Error(`duplicate key ${key}`);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (!isNeutral(lines[j]) && indentOf(lines[j]) <= base) break;
      body.push(lines[j]);
    }
    const raw = m.rest?.trim();
    const block = raw !== undefined && BLOCK_SCALAR.test(raw);
    const inline = block ? null : cleanScalar(m.rest);
    checkInline(key, inline);
    const dedented = dedent(body);
    if (inline === null && !block && dedented === "" && j < lines.length && lines[j].slice(base).startsWith("-")) {
      throw new Error(`a sequence at the same indentation as ${key} is not supported`);
    }
    found = { inline, body: dedented };
  }
  return found;
}

/** Base-level keys, in order. */
export function keys(text: string | null): string[] {
  const lines = split(text);
  const base = baseIndent(lines);
  const out: string[] = [];
  for (const l of lines) {
    if (isNeutral(l) || indentOf(l) !== base) continue;
    const m = parseKeyLine(l.slice(base));
    if (m) out.push(m.key);
  }
  return out;
}

/** The body of a base-level key, or null when the key is absent. */
export const topLevel = (text: string | null, key: string): string | null => entry(text, key)?.body ?? null;

/** Walk nested map bodies along `path`. */
export function at(text: string | null, path: string[]): string | null {
  let cur: string | null = text;
  for (const k of path) {
    if (cur === null) return null;
    cur = topLevel(cur, k);
  }
  return cur;
}

/** The inline value of a base-level key, or null. */
export const scalar = (text: string | null, key: string): string | null => entry(text, key)?.inline ?? null;

/** Base-level `- ` items, each dedented. Throws on a non-item line at the base. */
export function items(text: string | null): string[] {
  const lines = split(text);
  const base = baseIndent(lines);
  const out: string[][] = [];
  for (const l of lines) {
    if (isNeutral(l)) {
      out[out.length - 1]?.push(l);
      continue;
    }
    const ind = indentOf(l);
    const content = l.slice(base);
    if (ind === base) {
      if (!(content === "-" || content.startsWith("- "))) throw new Error(`expected a "- " item: ${JSON.stringify(l)}`);
      out.push([" ".repeat(base + 2) + content.slice(2)]);
    } else {
      if (!out.length) throw new Error(`indented line before the first item: ${JSON.stringify(l)}`);
      out[out.length - 1].push(l);
    }
  }
  return out.map(dedent);
}

/** A key's value as a list: a flow sequence `[a, b]`, a block sequence, or one inline scalar. */
export function list(text: string | null, key: string): string[] | null {
  const e = entry(text, key);
  if (!e) return null;
  if (e.inline !== null) {
    if (!e.inline.startsWith("[")) return [e.inline];
    if (!e.inline.endsWith("]")) throw new Error(`unterminated flow sequence at ${key}`);
    return e.inline
      .slice(1, -1)
      .split(",")
      .map((s) => cleanScalar(s))
      .filter((s): s is string => s !== null);
  }
  return items(e.body).map((s) => cleanScalar(s) ?? "");
}

export const jobIds = (text: string): string[] => keys(topLevel(text, "jobs"));

export const job = (text: string, id: string): string | null => {
  const jobs = topLevel(text, "jobs");
  return jobs === null ? null : topLevel(jobs, id);
};

export const steps = (jobText: string | null): string[] => {
  const s = topLevel(jobText, "steps");
  return s === null ? [] : items(s);
};

/** A step's `run:` script — inline or block scalar — or null. */
export function stepRun(step: string): string | null {
  const e = entry(step, "run");
  return e ? (e.inline ?? e.body) : null;
}

/**
 * The key of the nearest enclosing line (less indented, not blank or comment),
 * with a leading `- ` stripped; null when there is none or it is not a key line
 * (e.g. a less-indented line inside a block scalar).
 */
export function parentKey(text: string, lineIndex: number): string | null {
  const lines = split(text);
  const own = indentOf(lines[lineIndex] ?? "");
  for (let i = lineIndex - 1; i >= 0; i--) {
    const l = lines[i];
    if (isNeutral(l) || indentOf(l) >= own) continue;
    const content = l.trimStart().replace(/^-\s+/, "");
    return parseKeyLine(content)?.key ?? null;
  }
  return null;
}
