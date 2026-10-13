/**
 * Purpose: Parse and gate the per-area `#### Windows 差异` tables of the
 * feature ledger (ADR-0089, D191). Part 1's 状态 column is the macOS state;
 * each area may follow its inventory table with a `| 能力 | Windows | 说明 |`
 * table listing the capabilities whose Windows state differs or is unverified.
 * NO filesystem access lives here, same as `parse.mjs`.
 *
 * Pipeline: markdown text → parseWindowsDiffs → { tables, structural }
 *   → checkWindowsDiff* → Finding[]  (checkWindowsDiffs runs all four)
 *
 * Key decisions:
 * - Placement is strict. A difference table counts only inside Part 1 (from the
 *   `## Part 1` heading to the next `##`), under a `###` area, after that
 *   area's inventory table, and at most once per area. Anything else is a
 *   `windows-diff-structure` finding, never a silent skip, and its rows are not
 *   gated further: one finding per defect.
 * - A difference header without its heading, a heading with no table or the
 *   wrong header, and a header with no separator row are all findings too.
 * - 能力 matching is exact on the cell text after `splitRow` trimming, markdown
 *   included (backticks are compared raw), and per area: the cell must equal
 *   exactly one 能力 of the inventory table above it. Capability text is a key
 *   (ADR-0089 Consequences), so no folding of case or spacing.
 * - A `Partial` Windows cell needs a non-empty 说明, not Part 1's `限制：`
 *   marker: a difference row exists only because Windows differs, so its 说明
 *   is already the limit (ADR-0089 Decision; delegator ruling 2026-10-13).
 *
 * @module scripts/ledger/windowsDiff
 * @coordinates-with scripts/ledger/parse.mjs, scripts/ledger/check.mjs,
 *   scripts/ledger/table.mjs
 */
import { LEDGER_STATES } from "./parse.mjs";
import { isInventoryHeader, isSeparatorRow, splitRow } from "./table.mjs";

/** The level-4 heading text that opens a difference table. */
export const WINDOWS_DIFF_HEADING = "Windows 差异";

/** The exact header of a difference table. */
export const WINDOWS_DIFF_HEADER = Object.freeze(["能力", "Windows", "说明"]);

/** The ledger's five states plus `N/A` (no Windows counterpart). */
export const WINDOWS_STATES = Object.freeze([...LEDGER_STATES, "N/A"]);

const HEADER_TEXT = `| ${WINDOWS_DIFF_HEADER.join(" | ")} |`;

const finding = (rule, message, lineNumber) => ({ severity: "error", rule, message, lineNumber });

const isDiffHeader = (cells) =>
  cells !== null &&
  cells.length === WINDOWS_DIFF_HEADER.length &&
  cells.every((cell, i) => cell === WINDOWS_DIFF_HEADER[i]);

const isDiffHeading = (line) => /^####\s+(.*\S)\s*$/.exec(line)?.[1].trim() === WINDOWS_DIFF_HEADING;

/** Body rows of the table whose separator sits at `start - 1`; returns [cells[], next index]. */
function consumeBody(lines, start) {
  const body = [];
  let cursor = start;
  while (cursor < lines.length) {
    const cells = splitRow(lines[cursor]);
    if (cells === null || cells.length === 0) break;
    if (!isSeparatorRow(cells)) body.push({ cells, lineNumber: cursor + 1 });
    cursor += 1;
  }
  return [body, cursor];
}

/** Why a well-formed table at this point may not stand here, or null if it may. */
function misplacement(inPart1, area) {
  if (!inPart1) return "出现在 Part 1 之外，只有 Part 1 的分区可以带差异表";
  if (area === null) return "不在任何 `###` 分区之下";
  if (area.inventory === null) return `在分区「${area.name}」的清单表之前，上方没有可对照的清单表`;
  if (area.hasDiff) return `是分区「${area.name}」的第二张差异表，每个分区至多一张`;
  return null;
}

/**
 * Parse every difference table and every structural problem. `tables[]` holds
 * only well-placed tables: `{ area, lineNumber (heading), inventory, rows }`,
 * each row `{ capability, windows, note, area, lineNumber }`. `structural[]`
 * holds `{ lineNumber, message }` for everything that may not stand where it is.
 */
export function parseWindowsDiffs(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const tables = [];
  const structural = [];
  let inPart1 = false;
  let area = null;
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
      const text = heading[2].trim();
      if (heading[1].length === 2) {
        inPart1 = /^Part 1(?!\d)/.test(text);
        area = null;
      } else {
        area = { name: text, inventory: null, hasDiff: false };
      }
      continue;
    }

    const cells = splitRow(line);
    if (isInventoryHeader(cells)) {
      if (!isSeparatorRow(splitRow(lines[i + 1] ?? ""))) continue; // parse.mjs reports it
      const [body, next] = consumeBody(lines, i + 2);
      if (area !== null) area.inventory = body.map((r) => r.cells[0] ?? "");
      i = next - 1;
      continue;
    }

    if (isDiffHeader(cells)) {
      structural.push({ lineNumber: i + 1, message: `差异表头 ${HEADER_TEXT} 前缺少 \`#### ${WINDOWS_DIFF_HEADING}\` 标题` });
      i = consumeBody(lines, i + 1)[1] - 1;
      continue;
    }

    if (!isDiffHeading(line)) continue;

    const headingLine = i + 1;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j += 1;
    if (!isDiffHeader(splitRow(lines[j] ?? ""))) {
      structural.push({ lineNumber: headingLine, message: `\`#### ${WINDOWS_DIFF_HEADING}\` 之后必须紧跟表头 ${HEADER_TEXT}` });
      continue;
    }
    if (!isSeparatorRow(splitRow(lines[j + 1] ?? ""))) {
      structural.push({ lineNumber: headingLine, message: "差异表头下缺少分隔行 `| --- | … |`，HTML 会把它渲染成段落" });
      i = j;
      continue;
    }
    const [body, next] = consumeBody(lines, j + 2);
    i = next - 1;

    const problem = misplacement(inPart1, area);
    if (problem !== null) {
      structural.push({ lineNumber: headingLine, message: `差异表${problem}` });
      continue;
    }
    area.hasDiff = true;
    tables.push({
      area: area.name,
      lineNumber: headingLine,
      inventory: area.inventory,
      rows: body.map(({ cells: c, lineNumber }) => ({
        capability: c[0] ?? "",
        windows: c[1] ?? "",
        note: c[2] ?? "",
        area: area.name,
        lineNumber,
      })),
    });
  }

  return { tables, structural };
}

/** Every structural problem is a finding at its line. */
export function checkWindowsDiffStructure(parsed) {
  return parsed.structural.map(({ lineNumber, message }) =>
    finding("windows-diff-structure", message, lineNumber),
  );
}

/** Each 能力 names exactly one inventory row of its own area, and appears once. */
export function checkWindowsDiffMatches(parsed) {
  const findings = [];
  for (const table of parsed.tables) {
    const seen = new Set();
    for (const row of table.rows) {
      const cap = row.capability;
      const matches = table.inventory.filter((c) => c === cap).length;
      let problem = null;
      if (seen.has(cap)) problem = "在这张差异表里重复出现";
      else if (matches === 0) problem = "在上方清单表里没有对应行";
      else if (matches > 1) problem = `在上方清单表里对应 ${matches} 行，无法唯一匹配`;
      seen.add(cap);
      if (problem !== null) {
        findings.push(
          finding("windows-diff-match", `分区「${table.area}」的 Windows 差异「${cap}」${problem}`, row.lineNumber),
        );
      }
    }
  }
  return findings;
}

/** Every Windows cell is exactly one of WINDOWS_STATES. */
export function checkWindowsDiffStates(parsed) {
  return parsed.tables
    .flatMap((t) => t.rows)
    .filter((row) => !WINDOWS_STATES.includes(row.windows))
    .map((row) =>
      finding(
        "windows-diff-enum",
        `「${row.capability}」的 Windows 状态 "${row.windows}" 不在封闭枚举 ${WINDOWS_STATES.join(" / ")} 中`,
        row.lineNumber,
      ),
    );
}

/** A `Partial` Windows cell must say what is partial in 说明. */
export function checkWindowsDiffPartialNote(parsed) {
  return parsed.tables
    .flatMap((t) => t.rows)
    .filter((row) => row.windows === "Partial" && row.note.trim() === "")
    .map((row) =>
      finding("windows-diff-partial-note", `「${row.capability}」在 Windows 上是 Partial，但「说明」是空的`, row.lineNumber),
    );
}

/** All four Windows-difference gates over one ledger. */
export function checkWindowsDiffs(markdown) {
  const parsed = parseWindowsDiffs(markdown);
  return [
    ...checkWindowsDiffStructure(parsed),
    ...checkWindowsDiffMatches(parsed),
    ...checkWindowsDiffStates(parsed),
    ...checkWindowsDiffPartialNote(parsed),
  ];
}
