/**
 * Purpose: shared readers for the structural Rust-source tests of the
 * verify-run guard (ADR-0047 WI-002): comment-blanked source text, normalised
 * code lines, brace-matched fn bodies, and the brace depth inside a body.
 * Consumed by `tests/control/control-verify-run-wiring.test.ts` and
 * `tests/control/control-verify-run-publish-structure.test.ts`; shared here rather
 * than copied (rule 10).
 *
 * Key decisions:
 * - Sources go through `commentBlanker.mjs`, so a commented-out line never
 *   counts. String literals are kept, so a brace inside a string still
 *   counts toward brace matching; the guard's sources keep those balanced.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { blankComments } from "../../scripts/control/commentBlanker.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SRC_TAURI = path.join(REPO_ROOT, "src-tauri");

/** A `src-tauri`-relative Rust file with its comments blanked. */
export function readBlankedRust(rel: string): string {
  return blankComments(fs.readFileSync(path.join(SRC_TAURI, rel), "utf8"), "rust") as string;
}

/** Non-blank lines, whitespace-normalised (runs of whitespace → one space, trimmed). */
export function codeLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/** The text between `{` at `open` and its matching `}`. */
function braceBody(text: string, open: number, what: string): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`${what}: unbalanced braces`);
}

/** The brace-matched block after the first match of `re` (e.g. an `enum`). */
export function blockAfter(text: string, re: RegExp): string {
  const at = text.search(re);
  expect(at, `${re} exists`).toBeGreaterThanOrEqual(0);
  return braceBody(text, text.indexOf("{", at), String(re));
}

/** The text between the `{` that opens `fn <name>(` and its matching `}`. */
export function fnBody(text: string, name: string): string {
  const at = text.search(new RegExp(`\\bfn ${name}\\s*[(<]`));
  expect(at, `fn ${name} exists`).toBeGreaterThanOrEqual(0);
  return braceBody(text, text.indexOf("{", at), `fn ${name}`);
}

/**
 * The body of the closure whose head matches `re` (e.g. `.setup(move |app|`),
 * brace-matched from the first `{` after the head.
 */
export function closureBody(text: string, re: RegExp): string {
  const m = re.exec(text);
  expect(m, `${re} exists`).not.toBeNull();
  const at = (m?.index ?? 0) + (m?.[0].length ?? 0);
  return braceBody(text, text.indexOf("{", at), String(re));
}

/** Every `fn` in `text`, by name, with its brace-matched body. */
export function allFns(text: string): { name: string; body: string }[] {
  return [...text.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*[(<]/g)].map((m) => ({
    name: m[1],
    body: braceBody(text, text.indexOf("{", m.index ?? 0), `fn ${m[1]}`),
  }));
}

/**
 * The body of the one fn in `text` whose body contains `needle`. Located by
 * content, not by name, so renaming the fn does not move the check.
 */
export function fnContaining(text: string, needle: string): string {
  const hits = allFns(text).filter((f) => f.body.includes(needle));
  expect(
    hits.map((f) => f.name),
    `exactly one fn contains ${needle}`,
  ).toHaveLength(1);
  return hits[0].body;
}

/** Brace depth at `index` within `body` (0 = a top-level statement of the body). */
export function depthAt(body: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i++) {
    if (body[i] === "{") depth++;
    if (body[i] === "}") depth--;
  }
  return depth;
}

/** Every `.rs` file under `dir`, recursively, as absolute paths. */
export function rustFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return rustFiles(full);
    return e.name.endsWith(".rs") ? [full] : [];
  });
}
