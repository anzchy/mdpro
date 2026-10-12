/**
 * Purpose: The pure core of the patched-dependency guard (D181). Parses a
 * unified diff (the format pnpm writes to `patches/`) and, given a way to read
 * the installed package's files, reports every hunk that is not in effect.
 * No filesystem access here: `check-patched.mjs` supplies `readFile`, the
 * tests supply an in-memory one.
 *
 * Key decisions:
 * - A hunk counts as applied only when its whole NEW side (context plus added
 *   lines) appears as a contiguous run of whole lines AND its OLD side (context
 *   plus removed lines) does not appear outside that run. Looking for added
 *   lines one by one would pass a file where the same text sits somewhere else,
 *   and would never notice a removal-only hunk.
 * - "unpatched" (the original block is still there) and "drifted" (neither
 *   side matches) are both failures. Drift means the installed file is not the
 *   one the patch was written for, so the patch's claim cannot be confirmed.
 * - Line endings are normalised to LF on both sides; every other byte,
 *   indentation included, is significant, because pnpm applies the patch
 *   exactly.
 * - Line numbers in hunk headers are ignored: they only say where the patch
 *   was cut, and the guard asks whether the change is present, not where.
 *
 * @module scripts/deps/patchCheck
 * @coordinates-with scripts/deps/check-patched.mjs
 */

/** A patch that cannot be read as a unified diff. A guard must not pass on one. */
export class PatchParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "PatchParseError";
  }
}

const DEV_NULL = "/dev/null";
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** `a/dist/x.js\t2020-…` → `dist/x.js`; `/dev/null` stays as is. */
function cleanPath(raw) {
  const p = raw.split("\t")[0].trim();
  if (p === DEV_NULL) return p;
  return p.replace(/^[ab]\//, "");
}

/**
 * Parse a unified diff into files and hunks.
 * @param {string} text
 * @returns {Array<{ oldPath: string, newPath: string, hunks: Array<{ header: string, oldLines: string[], newLines: string[], added: string[], removed: string[] }> }>}
 */
export function parsePatch(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const files = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ")) {
      files.push({ oldPath: cleanPath(line.slice(4)), newPath: cleanPath(lines[i + 1].slice(4)), hunks: [] });
      i += 2;
      continue;
    }
    const m = HUNK_RE.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const file = files[files.length - 1];
    if (!file) throw new PatchParseError(`hunk before any file header: ${line}`);
    let oldLeft = m[2] === undefined ? 1 : Number(m[2]);
    let newLeft = m[4] === undefined ? 1 : Number(m[4]);
    const hunk = { header: line, oldLines: [], newLines: [], added: [], removed: [] };
    i += 1;
    while (oldLeft > 0 || newLeft > 0) {
      if (i >= lines.length) throw new PatchParseError(`hunk ends early: ${hunk.header}`);
      const body = lines[i];
      const tag = body[0];
      const rest = body.slice(1);
      if (tag === "\\") {
        // "\ No newline at end of file" — a marker, not content.
      } else if (tag === " " || body === "") {
        hunk.oldLines.push(rest);
        hunk.newLines.push(rest);
        oldLeft -= 1;
        newLeft -= 1;
      } else if (tag === "-") {
        hunk.oldLines.push(rest);
        hunk.removed.push(rest);
        oldLeft -= 1;
      } else if (tag === "+") {
        hunk.newLines.push(rest);
        hunk.added.push(rest);
        newLeft -= 1;
      } else {
        throw new PatchParseError(`unrecognised hunk line in ${hunk.header}: ${JSON.stringify(body)}`);
      }
      if (oldLeft < 0 || newLeft < 0) throw new PatchParseError(`hunk longer than its header says: ${hunk.header}`);
      i += 1;
    }
    file.hunks.push(hunk);
  }
  if (!files.some((f) => f.hunks.length > 0)) throw new PatchParseError("patch has no hunks");
  return files;
}

/** Overlapping occurrence count of `needle` in `hay`. */
function count(hay, needle) {
  let n = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) n += 1;
  return n;
}

/** Lines as a `\n`-fenced string, so a match is always a run of whole lines. */
const block = (lines) => `\n${lines.join("\n")}\n`;

function haystack(content) {
  const lf = content.replace(/\r\n/g, "\n");
  return `\n${lf}${lf.endsWith("\n") ? "" : "\n"}`;
}

function checkHunk(hay, hunk) {
  const newBlock = block(hunk.newLines);
  const newCount = count(hay, newBlock);
  let oldOutside = false;
  if (hunk.oldLines.length > 0 && block(hunk.oldLines) !== newBlock) {
    const oldBlock = block(hunk.oldLines);
    // The old side can sit inside the new side (an append-only hunk); those
    // occurrences are the patched code, not the original.
    oldOutside = count(hay, oldBlock) > newCount * count(newBlock, oldBlock);
  }
  if (newCount > 0 && !oldOutside) return null;
  return oldOutside ? "unpatched" : "drifted";
}

/**
 * Which hunks of `patchText` are not in effect in the files `readFile` returns.
 * @param {string} patchText unified diff, as pnpm writes it to `patches/`
 * @param {(relPath: string) => string | null} readFile null when the file does not exist
 * @returns {Array<{ file: string, hunk: number, header: string, kind: "missing" | "present" | "unpatched" | "drifted", expected?: string }>}
 *   `hunk` is 1-based; 0 with an empty header means the finding is about the whole file.
 * @throws {PatchParseError} when the patch cannot be parsed or has no hunks
 */
export function checkPatchApplied(patchText, readFile) {
  const findings = [];
  for (const file of parsePatch(patchText)) {
    if (file.newPath === DEV_NULL) {
      if (readFile(file.oldPath) !== null) findings.push({ file: file.oldPath, hunk: 0, header: "", kind: "present" });
      continue;
    }
    const content = readFile(file.newPath);
    if (content === null) {
      findings.push({ file: file.newPath, hunk: 0, header: "", kind: "missing" });
      continue;
    }
    const hay = haystack(content);
    file.hunks.forEach((hunk, index) => {
      const kind = checkHunk(hay, hunk);
      if (kind === null) return;
      const expected = hunk.added.length > 0 ? hunk.added[0] : `-${hunk.removed[0] ?? ""}`;
      findings.push({ file: file.newPath, hunk: index + 1, header: hunk.header, kind, expected });
    });
  }
  return findings;
}
