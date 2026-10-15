#!/usr/bin/env node
/**
 * Purpose: The one mechanical lint rule this repository has — rule 50 §1's
 * "never destructure a Zustand store at a component's top level". A call to a
 * `use*Store` hook with ZERO arguments is a whole-store subscription: it
 * re-renders on every field, including the ones the component never reads. The
 * prescribed forms are `useFooStore((s) => s.a)` and `useFooStore.getState()`.
 *
 * Pipeline: source text → ts.createSourceFile → forEachChild walk → Finding[]
 *
 * Key decisions ([ADR-0023](../../docs/adr/0023-one-lint-rule-enters-as-a-typescript-parser-script.md)):
 * - **Parsed, not grepped.** A regex for `use[A-Z]\w*Store\(\)` returns four
 *   hits on this tree and three of them are wrong: a `//` comment, a docblock,
 *   and a string literal inside an `expect(...)`. One of those comments is the
 *   comment that *documents rule 50 §1*. A gate whose first run reports the
 *   documentation of its own rule is a gate people learn to skip. The AST gets
 *   all four right for free.
 * - **`ts.createSourceFile` only — no `ts.createProgram`, no type checker.**
 *   The rule is syntax-only; a program would need tsconfig resolution and would
 *   turn a millisecond walk into a full type-check. `typescript` is already a
 *   direct devDependency, so this costs zero new packages.
 * - **KNOWN GAP, deliberate:** the identity selector `useXStore((s) => s)`
 *   defeats the rule but carries one argument, so it is not caught. Zero
 *   occurrences today. Catching it means inspecting the arrow body — a
 *   different and larger rule. This is not an oversight (ADR-0023 Decision 4).
 * - **Nothing here is enforced about `getState()`.** That is the other half of
 *   rule 50 §1 and remains unenforced.
 * - No filesystem access in `findBareStoreHookCalls`, matching
 *   `scripts/ledger/parse.mjs` — that is what makes it testable from Vitest
 *   without a fixture directory the scan would then eat as its own input.
 *
 * Usage: node scripts/lint/no-bare-store-hook.mjs [dir]   (default: src/)
 * The binding gate is `tests/tooling/lint-no-bare-store-hook.test.ts`, which rides the
 * existing `unit` lane; this CLI exists so a human can run it on one directory.
 *
 * @module scripts/lint/no-bare-store-hook
 * @coordinates-with tests/tooling/lint-no-bare-store-hook.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/**
 * A store hook is `use` + an uppercase-initial name + `Store`. `useStore` does
 * NOT match (there is no name between `use` and `Store`), and neither does
 * `useFoostore` — the capital S is the convention rule 50 §1 names.
 */
export const STORE_HOOK_RE = /^use[A-Z][A-Za-z0-9_]*Store$/;

/** Only TypeScript sources are scanned; `.js`/`.mjs` under src/ do not exist. */
export const SCAN_EXTENSIONS = Object.freeze([".ts", ".tsx"]);

/** Build output and vendored trees are never the author's code. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "coverage", "__snapshots__"]);

const scriptKindFor = (fileName) =>
  fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

/**
 * Every zero-argument `use*Store()` call in one source text.
 *
 * `fileName` is not read from disk — it only picks the ScriptKind, so a `.tsx`
 * fixture parses its JSX instead of choking on the first `<`.
 *
 * Returns `{ line, column, text }`, both coordinates 1-based so a finding can
 * be pasted straight into an editor's go-to-line.
 */
export function findBareStoreHookCalls(sourceText, fileName = "input.ts") {
  const source = ts.createSourceFile(
    fileName,
    String(sourceText),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(fileName),
  );

  const findings = [];

  const visit = (node) => {
    // `useFooStore.getState()` is a PropertyAccessExpression callee, not an
    // Identifier, so the isIdentifier guard alone exempts the prescribed
    // callback form. An argument of any kind means a selector was passed.
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isIdentifier(node.expression) &&
      STORE_HOOK_RE.test(node.expression.text)
    ) {
      const { line, character } = source.getLineAndCharacterOfPosition(
        node.expression.getStart(source),
      );
      findings.push({
        line: line + 1,
        column: character + 1,
        text: `${node.expression.text}()`,
      });
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return findings;
}

/**
 * Walk a directory tree and scan every `.ts`/`.tsx` file under it.
 *
 * `filesScanned` is returned alongside the findings on purpose: an empty result
 * from a walk that visited nothing looks identical to a clean pass, and the
 * test asserts the count so a broken path cannot quietly report success.
 * Paths in findings are relative to `rootDir`.
 */
export function scanTree(rootDir) {
  const findings = [];
  let filesScanned = 0;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      filesScanned += 1;
      for (const hit of findBareStoreHookCalls(fs.readFileSync(full, "utf-8"), full)) {
        findings.push({ file: path.relative(rootDir, full), ...hit });
      }
    }
  };

  walk(rootDir);
  return { findings, filesScanned };
}

/** One finding as a human-readable, editor-clickable line. */
export const formatFinding = (finding, rootDir = ".") =>
  `${path.join(rootDir, finding.file)}:${finding.line}:${finding.column}  ` +
  `bare whole-store subscription \`${finding.text}\` — use a per-field selector ` +
  `\`${finding.text.slice(0, -2)}((s) => s.field)\` (rule 50 §1)`;

// CLI. stdout IS the interface here, so console.log is correct in this file
// (rule 60's no-console rule scopes to src/).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const target = path.resolve(repoRoot, process.argv[2] ?? "src");
  const { findings, filesScanned } = scanTree(target);
  for (const finding of findings) console.log(formatFinding(finding, path.relative(repoRoot, target)));
  console.log(
    findings.length === 0
      ? `no-bare-store-hook: OK (${filesScanned} files scanned)`
      : `no-bare-store-hook: ${findings.length} finding(s) across ${filesScanned} files`,
  );
  process.exit(findings.length === 0 ? 0 : 1);
}
