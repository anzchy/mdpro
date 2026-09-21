/**
 * Purpose: Pure parsing + rule functions for the feature ledger
 * (`docs/feature-ledger.md`). NO filesystem access lives here — everything is a
 * function of the markdown string, which is what makes it testable from Vitest
 * without a fixture directory.
 *
 * Pipeline: markdown text → parseLedger → { sections, rows } → check* → Finding[]
 *
 * Key decisions:
 * - The inventory table is recognised ONLY by its exact 4-column header
 *   `| 能力 | 状态 | 在哪 | 怎么确认 |`. Every other pipe table in the document
 *   (comparators, gap matrices, drift tables) is data for humans, not rows for
 *   the gate; matching them would make the gate fight the prose.
 * - The state enum is CLOSED. `Shipped (WYSIWYG)` is a finding, because a state
 *   nobody can filter on is a state nobody can audit.
 *
 * @module scripts/ledger/parse
 * @coordinates-with scripts/ledger/check.mjs, scripts/ledger/render.mjs
 */

/** The closed set of ledger states. Nothing else is a valid 状态 cell. */
export const LEDGER_STATES = Object.freeze([
  "Shipped",
  "Partial",
  "Stub",
  "Absent",
  "Unknown",
]);

const INVENTORY_HEADER = ["能力", "状态", "在哪", "怎么确认"];
const EM_DASH = "—";
const PARTIAL_LIMIT_MARKER = "限制：";
const BUILD_OUTPUT_PREFIXES = [
  "dist/",
  "target/",
  "coverage/",
  "node_modules/",
  "src-tauri/gen/",
];

const finding = (rule, message, lineNumber) => ({
  severity: "error",
  rule,
  message,
  ...(lineNumber === undefined ? {} : { lineNumber }),
});

/**
 * Split one markdown table line into trimmed cells, honouring `\|` escapes.
 * Returns null when the line is not a table row.
 */
export function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells = [];
  let current = "";
  for (let i = 1; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") cells.push(current.trim());
  return cells;
}

const isSeparatorRow = (cells) =>
  cells !== null && cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));

const isInventoryHeader = (cells) =>
  cells !== null &&
  cells.length === INVENTORY_HEADER.length &&
  cells.every((cell, i) => cell === INVENTORY_HEADER[i]);

/**
 * GitHub-style anchor slug.
 *
 * Whitespace runs collapse to ONE hyphen. `generate_heading_id` in
 * `src-tauri/src/services/markdown.rs` carries the same invariant for a reason:
 * replacing each separator character individually turns "1. 文件与文档" into
 * "1--文件与文档" and every TOC link breaks silently.
 */
export function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/**
 * Parse the ledger markdown into its `##`/`###` sections and its inventory rows.
 * `lineNumber` is the 1-based source line and exists only so findings can point
 * at something a human can open.
 */
export function parseLedger(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const sections = [];
  const rows = [];
  let current = null;
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = /^(#{2,3})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      current = {
        level: heading[1].length,
        heading: heading[2].trim(),
        anchor: slugify(heading[2].trim()),
        rows: [],
      };
      sections.push(current);
      continue;
    }

    if (!isInventoryHeader(splitRow(line))) continue;

    // Header matched: skip the separator, then consume contiguous body rows.
    let cursor = i + 1;
    if (isSeparatorRow(splitRow(lines[cursor] ?? ""))) cursor += 1;
    while (cursor < lines.length) {
      const cells = splitRow(lines[cursor]);
      if (cells === null || cells.length === 0) break;
      if (!isSeparatorRow(cells)) {
        const row = {
          capability: cells[0] ?? "",
          state: cells[1] ?? "",
          where: cells[2] ?? "",
          confirm: cells[3] ?? "",
          section: current ? current.heading : "",
          lineNumber: cursor + 1,
        };
        rows.push(row);
        if (current) current.rows.push(row);
      }
      cursor += 1;
    }
    i = cursor - 1;
  }

  return { sections, rows };
}

/** Every 状态 cell must be exactly one of LEDGER_STATES. */
export function checkStates(rows) {
  return rows
    .filter((row) => !LEDGER_STATES.includes(row.state))
    .map((row) =>
      finding(
        "state-enum",
        `「${row.capability}」的状态 "${row.state}" 不在封闭枚举 ${LEDGER_STATES.join(" / ")} 中`,
        row.lineNumber,
      ),
    );
}

/**
 * A `Partial` without a named limit is indistinguishable from a `Shipped`
 * somebody was not sure about — which is the exact failure this ledger exists
 * to prevent. The limit must be written as `限制：…` in 怎么确认.
 */
export function checkPartialHasLimit(rows) {
  return rows
    .filter((row) => row.state === "Partial" && !row.confirm.includes(PARTIAL_LIMIT_MARKER))
    .map((row) =>
      finding(
        "partial-limit",
        `「${row.capability}」是 Partial，但「怎么确认」没有写出 ${PARTIAL_LIMIT_MARKER}<具体限制>`,
        row.lineNumber,
      ),
    );
}

/** `Absent` ⇔ 在哪 is the em dash. Both directions are findings. */
export function checkAbsentWhere(rows) {
  const findings = [];
  for (const row of rows) {
    const where = row.where.trim();
    if (row.state === "Absent" && where !== EM_DASH) {
      findings.push(
        finding(
          "absent-where",
          `「${row.capability}」是 Absent，「在哪」必须是 ${EM_DASH}，实际是 "${where}"`,
          row.lineNumber,
        ),
      );
    } else if (row.state !== "Absent" && where === EM_DASH) {
      findings.push(
        finding(
          "absent-where",
          `「${row.capability}」的状态是 ${row.state}，但「在哪」写成了 ${EM_DASH}`,
          row.lineNumber,
        ),
      );
    }
  }
  return findings;
}

const looksLikePath = (token) =>
  token.endsWith("/") || (token.includes("/") && /\.[A-Za-z0-9]{1,10}(:\d+)?$/.test(token));

/** Every backticked repo path inside a 在哪 cell, for resolution against disk. */
export function extractPathClaims(rows) {
  const claims = [];
  for (const row of rows) {
    for (const match of row.where.matchAll(/`([^`]+)`/g)) {
      const path = match[1].trim();
      if (looksLikePath(path)) claims.push({ path, row, lineNumber: row.lineNumber });
    }
  }
  return claims;
}

/**
 * A line number expires on the next edit to the file, and the path-resolution
 * check cannot catch it — the file still exists, so the claim stays green while
 * pointing at the wrong line. Ban the suffix outright.
 */
export function checkNoLineNumbers(claims) {
  return claims
    .filter((claim) => /:\d+$/.test(claim.path))
    .map((claim) =>
      finding(
        "no-line-numbers",
        `「在哪」不得带行号：\`${claim.path}\`（行号在下一次编辑后就失效，且路径检查抓不到）`,
        claim.lineNumber,
      ),
    );
}

/**
 * A Where claim on a build output is red on every fresh clone — `dist/` and
 * `target/` do not exist until somebody builds, so the gate would fail in CI
 * for a reason that has nothing to do with the ledger.
 */
export function checkNoBuildOutputs(claims) {
  return claims
    .filter((claim) => BUILD_OUTPUT_PREFIXES.some((prefix) => claim.path.startsWith(prefix)))
    .map((claim) =>
      finding(
        "no-build-outputs",
        `「在哪」不得指向构建产物：\`${claim.path}\`（在全新 clone 上不存在）`,
        claim.lineNumber,
      ),
    );
}

/**
 * The check that catches a surface nobody wrote a row for: every declared name
 * scanned out of the repo must appear somewhere in the ledger text.
 */
export function checkCoverage(declaredNames, markdown) {
  const text = String(markdown);
  return declaredNames
    .filter((entry) => !text.includes(entry.name))
    .map((entry) =>
      finding("coverage", `账簿未覆盖 ${entry.kind} "${entry.name}"（来源 ${entry.source}）`),
    );
}

/**
 * A bare `|` inside a code span silently truncates the cell: GFM splits a row
 * on pipes BEFORE resolving inline code, so everything after it vanishes from
 * the rendered HTML while the row still parses with four valid cells and every
 * other rule passes. `` `\|` `` renders as a literal pipe and keeps the cell
 * whole. Table rows only — in prose a pipe splits nothing.
 */
export function checkNoRawPipeInCode(markdown) {
  return markdown.split("\n").flatMap((line, i) => {
    if (!line.trimStart().startsWith("|")) return [];
    const span = (line.match(/`[^`]*`/g) ?? []).find((m) => /(^|[^\\])\|/.test(m));
    const msg = `代码片段 ${span} 里的竖线会把这一格截断 —— 写成 \`\\|\``;
    return span === undefined ? [] : [finding("no-raw-pipe-in-code", msg, i + 1)];
  });
}
