/**
 * Purpose: Find build inputs that reference a path `sourceTree` excludes
 * (`DEFAULT_EXCLUDES` in `sourceTree.mjs`). Such a reference would let a change
 * that does not move `buildId` still change the built app. Consumed by
 * `tests/control/control-build-inputs-guard.test.ts` (ADR-0047 plan, WI-5) and
 * `tests/control/control-build-inputs-guard-forms.test.ts` (WI-17).
 *
 * Pipeline: listBuildInputs(repoRoot) → per file findExcludedRefs(relPath,
 *   text, excludes): blank comments → refs from syntactic positions → resolve
 *   → repo-relative → match excludes → formatFindings(findings).
 *
 * Key decisions:
 * - Reference positions only, never raw text (`src/` mentions `docs/` in many
 *   comments). JS/TS: `import`, `import(…)`, `export … from`, `require(…)`,
 *   `import.meta.glob(…)`, `new URL(…, import.meta.url)`; bare package
 *   specifiers skipped; `vite.config.*` adds `root` / `publicDir` / `outDir` /
 *   `cacheDir` / `envDir`. Rust: `include!`, `include_str!`, `include_bytes!`,
 *   `#[path = "…"]`. HTML: `<script src>`, `<link href>`. CSS: `@import`,
 *   `url(…)`. Tauri config (`tauri.conf.json`, the verify profile's
 *   `tauri.verify.conf.json`, `capabilities/*.json`): every
 *   string value. `Cargo.toml`: `path` / `build` values (O10). `package.json`:
 *   values under `main`, `module`, `types`, `typings`, `browser`, `bin`,
 *   `files`, `exports`.
 * - Resolution (O10): against the containing file's directory, then
 *   repo-relative. Exception: Tauri config values resolve against `src-tauri/`
 *   (the Tauri config root, as Tauri does), so `../docs` in a capability file
 *   is `docs`. A leading `/` is the repo root in JS, HTML and CSS (Vite's root)
 *   and an absolute path elsewhere (ignored, like `scheme:` URLs and refs that
 *   leave the repo). `?query` / `#hash` are dropped first.
 * - Excludes are root-anchored, as in `sourceTree.mjs`: `dir/` is `dir` and
 *   everything under it; other entries are globs (`**` crosses directories,
 *   `*` does not) tested against the path and each ancestor.
 * - Comment blanking (`commentBlanker.mjs`) skips strings, Rust char literals
 *   and raw strings, so a ref in a comment is never reported and offsets are
 *   unchanged. One finding per offset (WI-17 fix: `@import url("…")` matched
 *   both CSS patterns).
 * - `ref` is reported as written; `line` is the 1-based line of the ref.
 *
 * @module scripts/control/buildInputsGuard
 * @coordinates-with scripts/control/commentBlanker.mjs (blankComments)
 */
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./commentBlanker.mjs";

/** @typedef {{ file: string, line: number, ref: string }} Finding */
/** @typedef {{ offset: number, ref: string, rootSlash: boolean, bareIsPackage: boolean, baseDir?: string }} RawRef */

// prettier-ignore
const SINGLE_FILES = [
  "src-tauri/build.rs", "src-tauri/tauri.conf.json", "src-tauri/tauri.verify.conf.json", "src-tauri/Cargo.toml",
  "vite.config.ts", "index.html", "package.json",
];
// The verify profile merges `tauri.verify.conf.json` via `--config` (D75c).
const TAURI_CONFIGS = new Set(["src-tauri/tauri.conf.json", "src-tauri/tauri.verify.conf.json"]);
const PACKAGE_PATH_FIELDS = new Set(["main", "module", "types", "typings", "browser", "bin", "files", "exports"]);
const JS_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const PKG = { rootSlash: true, bareIsPackage: true };
const WEB = { rootSlash: true, bareIsPackage: false };
const FS = { rootSlash: false, bareIsPackage: false };

/**
 * Build inputs, repo-relative POSIX, sorted: `src/**`, `src-tauri/src/**` minus
 * `*_tests.rs`, `src-tauri/capabilities/*.json`, and the SINGLE_FILES that exist.
 * @param {string} repoRoot @returns {string[]}
 */
export function listBuildInputs(repoRoot) {
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ rel, /** @type {boolean} */ deep) => {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) return;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.isDirectory() && deep) walk(`${rel}/${ent.name}`, deep);
      else if (ent.isFile()) files.push(`${rel}/${ent.name}`);
    }
  };
  walk("src", true);
  walk("src-tauri/src", true);
  walk("src-tauri/capabilities", false);
  for (const f of SINGLE_FILES) if (fs.existsSync(path.join(repoRoot, f))) files.push(f);
  const keep = (/** @type {string} */ f) =>
    !f.endsWith("_tests.rs") && (!f.startsWith("src-tauri/capabilities/") || f.endsWith(".json"));
  return [...new Set(files.filter(keep))].sort();
}

/** `re` is a `dg` regex whose LAST group is the ref. @param {string} text @param {RegExp} re @param {typeof FS} how @returns {RawRef[]} */
function collect(text, re, how) {
  return [...text.matchAll(re)].map((m) => {
    const g = m.length - 1;
    return { offset: /** @type {[number, number]} */ (m.indices?.[g])[0], ref: m[g], ...how };
  });
}

const Q = String.raw`(["'\x60])([^"'\x60\n]*)\1`;
/** @type {[RegExp, typeof FS][]} */
const JS_PATTERNS = [
  [new RegExp(String.raw`\bimport\b\s*(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s*)?(["'])([^"'\n]*)\1`, "dg"), PKG],
  [new RegExp(String.raw`\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(["'])([^"'\n]*)\1`, "dg"), PKG],
  [new RegExp(String.raw`\bimport\s*\(\s*${Q}`, "dg"), PKG],
  [new RegExp(String.raw`\brequire\s*\(\s*${Q}`, "dg"), PKG],
  [new RegExp(String.raw`\bimport\.meta\.glob(?:Eager)?\s*\(\s*${Q}`, "dg"), WEB],
  [new RegExp(String.raw`\bnew\s+URL\s*\(\s*${Q}\s*,\s*import\.meta\.url`, "dg"), WEB],
];
const VITE_KEYS = new RegExp(String.raw`\b(?:root|publicDir|outDir|cacheDir|envDir)\s*:\s*${Q}`, "dg");

/** @type {Record<string, [RegExp, typeof FS][]>} */
const OTHER_PATTERNS = {
  rust: [
    [/\binclude(?:_str|_bytes)?!\s*[([{]\s*(?:r#*)?"([^"\n]*)"/dg, FS],
    [/#\s*\[\s*path\s*=\s*"([^"\n]*)"\s*\]/dg, FS],
  ],
  html: [
    [/<script\b[^>]*?\bsrc\s*=\s*(["'])([^"'\n]*)\1/dgi, WEB],
    [/<link\b[^>]*?\bhref\s*=\s*(["'])([^"'\n]*)\1/dgi, WEB],
  ],
  css: [
    [/@import\s+(?:url\(\s*)?(["'])([^"'\n]*)\1/dg, WEB],
    [/\burl\(\s*(["']?)([^"')\s]+)\1\s*\)/dg, WEB],
  ],
};

/** @param {string} text @param {"js" | "rust" | "html" | "css"} lang @param {string} relPath @returns {RawRef[]} */
function codeRefs(text, lang, relPath) {
  const t =
    lang === "html"
      ? text.replace(/<!--[\s\S]*?(?:-->|$)/g, (c) => c.replace(/[^\n]/g, " "))
      : blankComments(text, lang);
  const refs = (lang === "js" ? JS_PATTERNS : OTHER_PATTERNS[lang]).flatMap(([re, how]) => collect(t, re, how));
  if (lang === "js" && /(^|\/)vite\.config\.[cm]?[jt]s$/.test(relPath)) refs.push(...collect(t, VITE_KEYS, WEB));
  return refs;
}

/**
 * String VALUES of a JSON text (a string followed by `:` in an object is a key,
 * not a value) whose top-level key passes `keep`.
 * @param {string} text @param {(topKey: string | null) => boolean} keep
 * @param {string} [baseDir] @returns {RawRef[]}
 */
function jsonRefs(text, keep, baseDir) {
  /** @type {RawRef[]} */
  const out = [];
  /** @type {{ kind: string, key: string | null }[]} */
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "[") stack.push({ kind: c, key: null });
    else if (c === "}" || c === "]") stack.pop();
    else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const literal = text.slice(i, j + 1);
      const value = /\\/.test(literal) ? JSON.parse(literal) : literal.slice(1, -1);
      const top = stack[stack.length - 1];
      if (top?.kind === "{" && /^\s*:/.test(text.slice(j + 1, j + 64))) top.key = value;
      else if (keep(stack[0]?.key ?? null)) out.push({ offset: i, ref: value, ...FS, baseDir });
      i = j;
    }
  }
  return out;
}

/** `path = "…"` / `build = "…"` values; a `#` comment outside a string is blanked. @param {string} text */
function cargoRefs(text) {
  const t = text.replace(/("(?:\\.|[^"\\\n])*"|'[^'\n]*')|#[^\n]*/g, (m, str) => str ?? m.replace(/./g, " "));
  return collect(t, /(?:^|[\s{,])(?:path|build)\s*=\s*(["'])([^"'\n]*)\1/dgm, FS);
}

/** @param {string} relPath @param {string} text @returns {RawRef[]} */
function rawRefs(relPath, text) {
  const base = relPath.split("/").pop() ?? "";
  if (TAURI_CONFIGS.has(relPath) || /^src-tauri\/capabilities\/[^/]+\.json$/.test(relPath)) {
    return jsonRefs(text, () => true, "src-tauri");
  }
  if (base === "package.json") return jsonRefs(text, (k) => k !== null && PACKAGE_PATH_FIELDS.has(k));
  if (base === "Cargo.toml") return cargoRefs(text);
  if (base.endsWith(".html")) return codeRefs(text, "html", relPath);
  if (base.endsWith(".rs")) return codeRefs(text, "rust", relPath);
  if (base.endsWith(".css")) return codeRefs(text, "css", relPath);
  return JS_EXT.test(base) ? codeRefs(text, "js", relPath) : [];
}

/**
 * Repo-relative target of a ref written in `relPath`, or null when it is not a
 * path inside the repo (package name, URL, absolute path, escapes the root).
 * @param {string} relPath @param {RawRef} r
 */
function resolveRef(relPath, r) {
  const spec = r.ref.replace(/[?#].*$/, "");
  if (spec === "" || SCHEME.test(spec)) return null;
  if (spec.startsWith("/") && !r.rootSlash) return null;
  if (!spec.startsWith("/") && !spec.startsWith(".") && r.bareIsPackage) return null;
  const joined = spec.startsWith("/")
    ? path.posix.normalize(`.${spec}`)
    : path.posix.normalize(path.posix.join(r.baseDir ?? path.posix.dirname(relPath), spec));
  const target = joined.replace(/\/+$/, "");
  return target === "" || target === "." || target === ".." || target.startsWith("../") ? null : target;
}

/** @param {string} glob */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith("**/", i)) (re += "(?:.*/)?"), (i += 2);
    else if (glob.startsWith("**", i)) (re += ".*"), (i += 1);
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** @param {readonly string[]} excludes @returns {(p: string) => boolean} */
function excludeMatcher(excludes) {
  const tests = excludes.map((e) => {
    if (e.endsWith("/")) {
      const dir = e.replace(/\/+$/, "");
      return (/** @type {string} */ p) => p === dir || p.startsWith(`${dir}/`);
    }
    const re = globToRegExp(e);
    return (/** @type {string} */ p) => p.split("/").some((_, k, parts) => re.test(parts.slice(0, k + 1).join("/")));
  });
  return (p) => tests.some((t) => t(p));
}

/**
 * References in one build input that resolve into an excluded root.
 * @param {string} relPath repo-relative POSIX path of the file
 * @param {string} text its content
 * @param {readonly string[]} excludes e.g. `DEFAULT_EXCLUDES`
 * @returns {Finding[]} in file order
 */
export function findExcludedRefs(relPath, text, excludes) {
  if (typeof relPath !== "string" || typeof text !== "string" || !Array.isArray(excludes)) {
    throw new TypeError("findExcludedRefs(relPath: string, text: string, excludes: string[])");
  }
  const excluded = excludeMatcher(excludes);
  return rawRefs(relPath, text)
    .filter((r) => {
      const target = resolveRef(relPath, r);
      return target !== null && excluded(target);
    })
    .sort((a, b) => a.offset - b.offset)
    .filter((r, k, all) => k === 0 || all[k - 1].offset !== r.offset) // `@import url("…")` matches both CSS patterns
    .map((r) => ({ file: relPath, line: text.slice(0, r.offset).split("\n").length, ref: r.ref }));
}

/** @param {Finding[]} findings @returns {string} one `file:line  ref` line per finding */
export function formatFindings(findings) {
  if (findings.length === 0) return "no build input references an excluded root";
  const lines = findings.map((f) => `  ${f.file}:${f.line}  ${f.ref}`);
  return `${findings.length} build-input reference(s) into an excluded root:\n${lines.join("\n")}`;
}
