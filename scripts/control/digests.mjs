/**
 * Purpose: Artifact digests for the build manifest — the sha256 of one file,
 * a content digest of a directory tree (used for `dist`), and the handful of
 * signing fields worth keeping from `codesign -dvvv` output.
 *
 * Pipeline:
 *   sha256File(path)        → read in chunks → sha256 hex
 *   digestDir(dir)          → walk regular files → "relPosixPath NUL sha256hex LF"
 *                             per file → sort lines by code unit → join → sha256 hex
 *   parseCodesign(stderr)   → keep only Identifier= / Format= / CDHash= /
 *                             Signature= / TeamIdentifier= → validated object
 *
 * Key decisions:
 * - `digestDir` is a pure function of the set {(posixRelPath, sha256(content))}:
 *   creation order, enumeration order, mtimes and modes do not enter it. Empty
 *   directories contribute nothing, so an empty tree hashes to sha256("")
 *   (e3b0…b855). Lines are sorted with the default `Array.prototype.sort()`
 *   (UTF-16 code-unit order), never `localeCompare`.
 * - A symlink or any other non-regular entry (socket, FIFO, device) inside the
 *   tree throws. Following a link would make the digest depend on something
 *   outside the tree, and skipping it would let a change go unseen; a build
 *   output (`dist`) never contains either, so refusing is the safe default.
 * - `parseCodesign` (plan decisions 8, O7, O14) never digests the raw output,
 *   because `Executable=` carries a home path. `identifier`, `format` and
 *   `cdhash` are required (missing or empty throws: an unsigned bundle is an
 *   error, not an empty field); a missing `Signature=` line (Developer ID
 *   prints `Signature size=` instead) or `TeamIdentifier=` line gives `null`.
 *   A kept value starting with `/` or `~` throws, so no path can leak through.
 *   Error messages name the field but never echo the value.
 *
 * @module scripts/control/digests
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CHUNK_BYTES = 64 * 1024;

/** Thrown for any digest or codesign-parse failure; the message names the path or field. */
export class DigestError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "DigestError";
  }
}

/** @param {unknown} e */
const reason = (e) => (e instanceof Error ? e.message : String(e));

/**
 * sha256 of a file's bytes, read in fixed-size chunks.
 * @param {string} filePath
 * @returns {string} 64-char lowercase hex
 * @throws {DigestError} when the file cannot be read; the message contains the path
 */
export function sha256File(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch (e) {
    throw new DigestError(`sha256File: cannot open ${filePath}: ${reason(e)}`);
  }
  try {
    const hash = createHash("sha256");
    const buf = Buffer.allocUnsafe(CHUNK_BYTES);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK_BYTES, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
    return hash.digest("hex");
  } catch (e) {
    throw new DigestError(`sha256File: cannot read ${filePath}: ${reason(e)}`);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {string} root absolute root of the walk
 * @param {string} rel  posix path of the current directory relative to root ("" at the top)
 * @param {string[]} lines accumulator
 */
function collect(root, rel, lines) {
  const abs = rel === "" ? root : path.join(root, ...rel.split("/"));
  for (const name of fs.readdirSync(abs)) {
    const childRel = rel === "" ? name : `${rel}/${name}`;
    const childAbs = path.join(abs, name);
    const st = fs.lstatSync(childAbs);
    if (st.isDirectory()) {
      collect(root, childRel, lines);
    } else if (st.isFile()) {
      lines.push(`${childRel}\0${sha256File(childAbs)}\n`);
    } else {
      const kind = st.isSymbolicLink() ? "a symlink" : "not a regular file";
      throw new DigestError(`digestDir: ${childAbs} is ${kind}; only regular files are digested`);
    }
  }
}

/**
 * Content digest of a directory tree: sha256 over the code-unit-sorted lines
 * `relativePosixPath NUL sha256(content) LF`, one per regular file.
 * @param {string} dir
 * @returns {string} 64-char lowercase hex
 * @throws {DigestError} when `dir` is missing or not a directory (message contains the
 *   path), or the tree holds a symlink or other non-regular entry
 */
export function digestDir(dir) {
  let st;
  try {
    st = fs.statSync(dir);
  } catch (e) {
    throw new DigestError(`digestDir: cannot stat ${dir}: ${reason(e)}`);
  }
  if (!st.isDirectory()) {
    throw new DigestError(`digestDir: ${dir} is not a directory`);
  }
  /** @type {string[]} */
  const lines = [];
  collect(dir, "", lines);
  lines.sort();
  return createHash("sha256").update(lines.join(""), "utf8").digest("hex");
}

/** codesign key → output field, and whether the field is required. */
const CODESIGN_FIELDS = Object.freeze({
  Identifier: { field: "identifier", required: true },
  Format: { field: "format", required: true },
  CDHash: { field: "cdhash", required: true },
  Signature: { field: "signature", required: false },
  TeamIdentifier: { field: "teamIdentifier", required: false },
});

/**
 * @typedef {{ identifier: string, format: string, cdhash: string,
 *   signature: string | null, teamIdentifier: string | null }} CodesignInfo
 */

/**
 * Select the five signing fields from `codesign -dvvv` output (its stderr).
 * Every other line, `Executable=` included, is dropped.
 * @param {string} text
 * @returns {CodesignInfo}
 * @throws {DigestError} when CDHash, Identifier or Format is missing or empty, a key
 *   repeats, or a kept value starts with `/` or `~`; the message names the field
 */
export function parseCodesign(text) {
  if (typeof text !== "string") {
    throw new DigestError(`parseCodesign: expected the codesign output as a string, got ${typeof text}`);
  }
  /** @type {Record<string, string>} */
  const found = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    if (!Object.hasOwn(CODESIGN_FIELDS, key)) continue;
    if (Object.hasOwn(found, key)) {
      throw new DigestError(`parseCodesign: ${key}= appears more than once`);
    }
    found[key] = line.slice(eq + 1).trim();
  }

  const missing = Object.entries(CODESIGN_FIELDS)
    .filter(([key, spec]) => spec.required && !found[key])
    .map(([key, spec]) => `${key}= (${spec.field})`);
  if (missing.length > 0) {
    const hint = found.CDHash ? "" : "; is the bundle signed?";
    throw new DigestError(`parseCodesign: missing or empty ${missing.join(", ")}${hint}`);
  }

  /** @type {Record<string, string | null>} */
  const out = {};
  for (const [key, spec] of Object.entries(CODESIGN_FIELDS)) {
    const value = found[key] ? found[key] : null;
    if (value !== null && (value.startsWith("/") || value.startsWith("~"))) {
      throw new DigestError(`parseCodesign: ${spec.field} (${key}=) is a rooted path; refusing to record it`);
    }
    out[spec.field] = value;
  }
  return /** @type {CodesignInfo} */ (out);
}
