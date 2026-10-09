/**
 * @module test/appCss
 * Purpose: Test-only reader for the app's global CSS (plan P WI-1.1). It follows
 * the `@import` lines of `src/styles/index.css` — the one entry `src/main.tsx`
 * loads — and returns the CSS in import order, per file or concatenated. Tests
 * that assert on app CSS read it through here instead of opening
 * `src/styles/globals.css` by path, so they keep passing when Stage 1 moves
 * sections into partials.
 *
 * Pipeline: entry text → strip comments → validate every remaining line is one
 * `@import "<relative path>";` → resolve each against the entry's directory →
 * contain it within the styles root → refuse duplicates → read each file.
 *
 * Key decisions:
 *   - Strict, not forgiving. Anything besides comments, blank lines and plain
 *     `@import "…";` lines (url(), media queries, rules, two imports per line)
 *     throws, as do duplicates, absolute paths, paths outside the root and
 *     missing files. A skipped import would let a test pass over CSS the app
 *     never loads — or miss CSS it does.
 *   - Concatenation is a plain join with no separator, the same bytes `cat`
 *     produces, so the pure-move proof and this reader agree.
 *   - "Theme" means a root-relative path under `themes/`; the non-theme
 *     concatenation is everything else, in order.
 *   - `entryPath` / `entryContents` / `root` exist so tests can exercise the
 *     validation on fixtures without editing the real `index.css`.
 *   - Node-only (`node:fs`). Nothing in the app bundle imports this file; it
 *     lives under `src/` so `tsc` type-checks it with the build.
 *
 * @coordinates-with src/styles/index.css — the entry it parses
 * @coordinates-with src/main.tsx — imports the same entry
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where to read the entry from. All fields are optional. */
export interface AppCssSource {
  /** Entry file path. Default: `src/styles/index.css`. */
  entryPath?: string;
  /** Entry text to use instead of reading `entryPath` (imports still resolve against its directory). */
  entryContents?: string;
  /** Directory every import must resolve inside. Default: the entry's directory. */
  root?: string;
}

/** One imported stylesheet. */
export interface AppCssFile {
  /** The specifier as written in the entry, e.g. `./themes/light.css`. */
  specifier: string;
  /** Path relative to the root, `/`-separated, e.g. `themes/light.css`. */
  relPath: string;
  absPath: string;
  /** True when `relPath` is under `themes/`. */
  isTheme: boolean;
  css: string;
}

// A string, not `new URL(...)`: under jsdom the global URL is jsdom's, which
// `fileURLToPath` rejects ("The URL must be of scheme file").
const DEFAULT_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../styles/index.css");
const IMPORT_LINE = /^@import\s+"([^"]+)";$/;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const THEME_PREFIX = "themes/";

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Replace each comment with its own newlines so line numbers survive for error messages. */
function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, (comment) => comment.replace(/[^\n]/g, ""));
}

interface ResolvedImport {
  specifier: string;
  relPath: string;
  absPath: string;
}

/** Parse and validate the entry; return its imports in order. Throws on any violation. */
function parseEntry(text: string, entryPath: string, root: string): ResolvedImport[] {
  const entryDir = path.dirname(entryPath);
  const seen = new Map<string, number>();
  const imports: ResolvedImport[] = [];

  stripComments(text)
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const lineNo = index + 1;
      const line = rawLine.trim();
      if (line === "") return;

      const match = IMPORT_LINE.exec(line);
      if (!match) {
        throw new Error(
          `appCss: ${entryPath}:${lineNo} is not a comment or @import "<path>"; line: ${line}`,
        );
      }
      const specifier = match[1];
      if (path.isAbsolute(specifier)) {
        throw new Error(`appCss: ${entryPath}:${lineNo} imports an absolute path: ${specifier}`);
      }

      const absPath = path.resolve(entryDir, specifier);
      const rel = path.relative(root, absPath);
      if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        throw new Error(
          `appCss: ${entryPath}:${lineNo} imports ${specifier}, which resolves outside ${root}`,
        );
      }

      const firstLine = seen.get(absPath);
      if (firstLine !== undefined) {
        throw new Error(
          `appCss: ${entryPath}:${lineNo} is a duplicate import of ${specifier} (first at line ${firstLine})`,
        );
      }
      seen.set(absPath, lineNo);
      imports.push({ specifier, relPath: toPosix(rel), absPath });
    });

  if (imports.length === 0) {
    throw new Error(`appCss: ${entryPath} has no @import lines`);
  }
  return imports;
}

function readImport(entryPath: string, imp: ResolvedImport): string {
  let isFile = false;
  try {
    isFile = fs.statSync(imp.absPath).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new Error(`appCss: ${entryPath} imports ${imp.specifier}, but ${imp.absPath} is missing`);
  }
  return fs.readFileSync(imp.absPath, "utf-8");
}

/** Every stylesheet the entry imports, in import order. */
export function readAppCssFiles(source: AppCssSource = {}): AppCssFile[] {
  const entryPath = path.resolve(source.entryPath ?? DEFAULT_ENTRY);
  const root = path.resolve(source.root ?? path.dirname(entryPath));
  const text = source.entryContents ?? fs.readFileSync(entryPath, "utf-8");

  return parseEntry(text, entryPath, root).map((imp) => ({
    ...imp,
    isTheme: imp.relPath.startsWith(THEME_PREFIX),
    css: readImport(entryPath, imp),
  }));
}

/** All app CSS concatenated in import order (themes included). */
export function readAppCss(source: AppCssSource = {}): string {
  return readAppCssFiles(source)
    .map((f) => f.css)
    .join("");
}

/** App CSS concatenated in import order, excluding `themes/` files. */
export function readAppCssNonTheme(source: AppCssSource = {}): string {
  return readAppCssFiles(source)
    .filter((f) => !f.isTheme)
    .map((f) => f.css)
    .join("");
}

/**
 * One imported file's CSS, by root-relative path (`themes/light.css`; a leading
 * `./` is accepted). Throws if the entry does not import that file, so a test
 * cannot assert on CSS the app never loads.
 */
export function readAppCssFile(relPath: string, source: AppCssSource = {}): string {
  const wanted = path.posix.normalize(relPath.replace(/\\/g, "/"));
  const file = readAppCssFiles(source).find((f) => f.relPath === wanted);
  if (!file) {
    throw new Error(`appCss: ${relPath} is not imported by the app CSS entry`);
  }
  return file.css;
}
