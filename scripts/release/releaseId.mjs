/**
 * Purpose: Check that a release's macOS app binaries carry the release id the
 * workflow compiled into them (D175). release.yml's app build step sets
 * `MDPRO_RELEASE_ID=<version>@<preflight 40-hex SHA>`; the bin reads it with
 * `option_env!` and logs it as `releaseId` in `app.ready`. This module looks
 * for that exact string inside `Contents/MacOS/tauri-app` of each macOS
 * updater archive, so a draft built without it (or from another commit)
 * cannot be published.
 *
 * Pipeline: releaseIdArchives() (the updater archives of REQUIRED_PLATFORMS)
 *   → per archive: read → gunzip → walk the tar headers → the one regular
 *   file `<x>.app/Contents/MacOS/tauri-app` → its bytes contain the id?
 *
 * Key decisions:
 * - Only the macOS `.app.tar.gz` archives are checked. They are the updater
 *   payload every installed client downloads, and the main binary sits in
 *   them as plain bytes once gunzipped. The Windows NSIS installer, the
 *   Linux AppImage (squashfs), `.deb` and `.rpm` compress the binary with
 *   formats Node cannot open without a dependency, so they are not checked.
 * - The tar walk reads ustar and GNU headers by their `name` field (plus the
 *   POSIX `prefix`). GNU long names and pax headers are not decoded: an
 *   archive that needed them would have no matching `tauri-app` entry and
 *   would fail, never pass.
 * - Only `tauri-app` (the Cargo bin, `src-tauri/Cargo.toml` [[bin]]) counts.
 *   The sidecar `mdpro_mcp` sits beside it but is built without the variable,
 *   and a file of the same name elsewhere in the bundle is not the binary.
 * - Fail closed: an unreadable, non-gzip or truncated archive, zero or two
 *   `tauri-app` entries, or a binary without the exact id are all errors.
 *
 * @module scripts/release/releaseId
 * @coordinates-with scripts/release/verify-release.mjs (runs the check on the draft)
 * @coordinates-with .github/workflows/release.yml (sets MDPRO_RELEASE_ID)
 * @coordinates-with src-tauri/src/services/release_info.rs (validates the id in the app)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PLATFORM_SPECS, REQUIRED_PLATFORMS } from "./assetNames.mjs";

/** The app's main executable inside `<x>.app/Contents/MacOS/`. */
export const MAIN_BINARY = "tauri-app";

const BLOCK = 512;
const MAIN_PATH = new RegExp(`^(?:\\./)?[^/]+\\.app/Contents/MacOS/${MAIN_BINARY}$`);

/**
 * The id release.yml compiles into the app.
 * @param {string} version X.Y.Z
 * @param {string} sha 40-hex commit
 */
export const releaseIdFor = (version, sha) => `${version}@${sha}`;

/** Names of the macOS updater archives the id is checked in. */
export function releaseIdArchives() {
  return REQUIRED_PLATFORMS.flatMap((p) =>
    PLATFORM_SPECS[p].files.filter((f) => f.updater).map((f) => f.final("")),
  );
}

/** @param {Buffer} h @param {number} at @param {number} len */
const field = (h, at, len) => {
  const raw = h.subarray(at, at + len);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? len : end).toString("utf8");
};

/**
 * The bytes of `<x>.app/Contents/MacOS/tauri-app` inside a `.app.tar.gz`.
 * @param {Buffer} gz
 * @returns {{ data: Buffer, error?: undefined } | { error: string, data?: undefined }}
 */
export function findMainBinary(gz) {
  let t;
  try {
    t = zlib.gunzipSync(gz);
  } catch {
    return { error: "is not a gzip archive" };
  }
  /** @type {Buffer[]} */
  const found = [];
  let off = 0;
  for (;;) {
    if (off + BLOCK > t.length) return { error: "is a truncated tar (no end-of-archive block)" };
    const h = t.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    const sizeField = field(h, 124, 12).trim();
    if (!/^[0-7]+$/.test(sizeField)) return { error: `has a tar header with an unreadable size at offset ${off}` };
    const size = parseInt(sizeField, 8);
    const prefix = h.subarray(257, 263).toString("latin1") === "ustar\0" ? field(h, 345, 155) : "";
    const name = prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100);
    const type = String.fromCharCode(h[156]);
    const start = off + BLOCK;
    if (start + size > t.length) return { error: `is a truncated tar (${name} runs past the end)` };
    if ((type === "0" || type === "\0") && MAIN_PATH.test(name)) found.push(t.subarray(start, start + size));
    off = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (found.length !== 1) return { error: `has ${found.length} Contents/MacOS/${MAIN_BINARY} entries, expected exactly 1` };
  return { data: found[0] };
}

/**
 * Every macOS updater archive in `dir` must carry `<version>@<sha>` in its
 * main binary.
 * @param {{ dir: string, version: string, sha: string }} o
 * @returns {{ ok: boolean, errors: string[], releaseId: string }}
 */
export function checkReleaseId({ dir, version, sha }) {
  const releaseId = releaseIdFor(version, sha);
  const needle = Buffer.from(releaseId, "utf8");
  /** @type {string[]} */
  const errors = [];
  for (const name of releaseIdArchives()) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) {
      errors.push(`${name} is missing, so its release id cannot be checked`);
      continue;
    }
    const bin = findMainBinary(fs.readFileSync(p));
    if (!bin.data) {
      errors.push(`${name} ${bin.error}; cannot check its release id ${releaseId}`);
    } else if (!bin.data.includes(needle)) {
      errors.push(
        `${name}: Contents/MacOS/${MAIN_BINARY} does not contain the release id ${releaseId}; ` +
          "the app was not built with MDPRO_RELEASE_ID for this version and commit",
      );
    }
  }
  return { ok: errors.length === 0, errors, releaseId };
}
