/**
 * Purpose: A deliberately small markdown → HTML renderer for the feature
 * ledger. Covers exactly the subset the ledger uses: headings, pipe tables,
 * paragraphs, lists, bold/em/code/strike, links, blockquotes, `---`, fences.
 *
 * Pipeline: markdown → renderMarkdown → { html, headings }
 *
 * Key decisions:
 * - No markdown library. Adding `marked` to the renderer would make the
 *   "zero runtime dependencies, opens from file://" property depend on an
 *   install step, and the ledger's syntax surface is ~8 constructs wide.
 * - EVERYTHING from the source is HTML-escaped before any inline rule runs.
 *   The ledger's own cells contain literal `<mark style="…">` (it is a
 *   highlight-plugin config value); it must read as text, never become markup.
 * - Inventory `<tr>`s are tagged `data-state` so the client-side chips can
 *   filter without re-parsing the DOM text.
 *
 * @module scripts/ledger/md
 * @coordinates-with scripts/ledger/render.mjs, scripts/ledger/parse.mjs,
 *   scripts/ledger/table.mjs
 */
import { LEDGER_STATES, slugify } from "./parse.mjs";
import { isInventoryHeader, isSeparatorRow, splitRow } from "./table.mjs";

const SENTINEL = "\u0000";

export const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Reverses `escapeHtml`, so a target is escaped exactly once on output. */
const unescapeHtml = (text) =>
  String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const ALLOWED_SCHEME = /^(https?|mailto):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Blocklist by scheme, not allowlist by prefix: the ledger links to its
 * siblings as scheme-less relative paths (`plans/…`, `adr/…`), and the HTML is
 * written next to the markdown in `docs/`, so those resolve as-is. Any explicit
 * scheme other than http(s)/mailto (`javascript:`, `data:`, `file:` …) becomes
 * `#`, and so does protocol-relative `//host`, which would leave the repo.
 */
const safeHref = (raw) => {
  const href = raw.trim();
  if (href.startsWith("//")) return "#";
  if (ANY_SCHEME.test(href) && !ALLOWED_SCHEME.test(href)) return "#";
  return escapeHtml(href);
};

/**
 * Inline rules. Code spans are lifted out first so that `**` inside a code span
 * stays literal, then the remainder is escaped and decorated.
 */
export function renderInline(text) {
  const codes = [];
  let work = String(text).replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(escapeHtml(code));
    return `${SENTINEL}${codes.length - 1}${SENTINEL}`;
  });

  work = escapeHtml(work)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      return `<a href="${safeHref(unescapeHtml(href))}">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return work.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"), (_m, i) => `<code>${codes[i]}</code>`);
}

const stateBadge = (state) => {
  const known = LEDGER_STATES.includes(state);
  const cls = known ? `badge badge-${state.toLowerCase()}` : "badge badge-invalid";
  return `<span class="${cls}">${escapeHtml(state)}</span>`;
};

function renderTable(lines, start) {
  const header = splitRow(lines[start]);
  if (!isSeparatorRow(splitRow(lines[start + 1] ?? ""))) return null;
  const inventory = isInventoryHeader(header);

  let cursor = start + 2;
  const body = [];
  while (cursor < lines.length) {
    const cells = splitRow(lines[cursor]);
    if (cells === null || cells.length === 0) break;
    if (!isSeparatorRow(cells)) body.push(cells);
    cursor += 1;
  }

  const head = `<tr>${header.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr>`;
  const rows = body
    .map((cells) => {
      const padded = header.map((_c, i) => cells[i] ?? "");
      if (!inventory) {
        return `<tr>${padded.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`;
      }
      const state = padded[1].trim();
      const tds = padded
        .map((cell, i) => (i === 1 ? `<td>${stateBadge(state)}</td>` : `<td>${renderInline(cell)}</td>`))
        .join("");
      return `<tr class="inv-row" data-state="${escapeHtml(state)}">${tds}</tr>`;
    })
    .join("");

  const cls = inventory ? ' class="inventory"' : "";
  return {
    html: `<div class="table-wrap"><table${cls}><thead>${head}</thead><tbody>${rows}</tbody></table></div>`,
    next: cursor,
  };
}

function flushList(buffer, ordered, out) {
  if (buffer.length === 0) return;
  const tag = ordered ? "ol" : "ul";
  out.push(`<${tag}>${buffer.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
  buffer.length = 0;
}

/**
 * Render the ledger markdown.
 * @returns {{ html: string, headings: { level: number, text: string, anchor: string }[] }}
 */
export function renderMarkdown(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const out = [];
  const headings = [];
  const seen = new Map();
  let list = [];
  let listOrdered = false;
  let paragraph = [];
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote><p>${renderInline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList(list, listOrdered, out);
  };

  const uniqueAnchor = (text) => {
    const base = slugify(text) || "heading";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^\s*(```|~~~)/.test(line)) {
      flushAll();
      const buf = [];
      let cursor = i + 1;
      while (cursor < lines.length && !/^\s*(```|~~~)/.test(lines[cursor])) {
        buf.push(lines[cursor]);
        cursor += 1;
      }
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      i = cursor;
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      out.push("<hr />");
      continue;
    }

    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].trim();
      const anchor = uniqueAnchor(text);
      if (level === 2 || level === 3) headings.push({ level, text, anchor });
      out.push(`<h${level} id="${anchor}">${renderInline(text)}</h${level}>`);
      continue;
    }

    const cells = splitRow(line);
    if (cells !== null && cells.length > 1) {
      const table = renderTable(lines, i);
      if (table) {
        flushAll();
        out.push(table.html);
        i = table.next - 1;
        continue;
      }
    }

    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList(list, listOrdered, out);
      quote.push(quoted[1]);
      continue;
    }
    flushQuote();

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list.length > 0 && ordered !== listOrdered) flushList(list, listOrdered, out);
      listOrdered = ordered;
      list.push((bullet ?? numbered)[1]);
      continue;
    }
    flushList(list, listOrdered, out);

    paragraph.push(line.trim());
  }

  flushAll();
  return { html: out.join("\n"), headings };
}
