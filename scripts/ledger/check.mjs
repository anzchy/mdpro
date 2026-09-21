#!/usr/bin/env node
/**
 * Purpose: The mechanical gate for `docs/feature-ledger.md`. Runs every rule in
 * `parse.mjs`, resolves every backticked path claim against the working tree,
 * and exits non-zero on any finding. stdout IS the interface here, so
 * `console.log` is correct in this file (rule 60's no-console rule scopes to
 * `src/`).
 *
 * Usage: node scripts/ledger/check.mjs [--require]
 *
 * Key decisions:
 * - A missing ledger is a loud skip (exit 0) by default and a hard failure with
 *   `--require`. A gate that cannot run on a clean checkout is not a gate — but
 *   this ledger is tracked in git, so the skip branch should essentially never
 *   fire. It exists for the `git worktree add --no-checkout` / partial-clone
 *   case, not as an escape hatch.
 * - Path claims resolve with `fs.existsSync` relative to the repo root, not to
 *   cwd, so the gate gives the same answer from any directory.
 *
 * @module scripts/ledger/check
 * @coordinates-with scripts/ledger/parse.mjs, scripts/ledger/declared.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectDeclaredNames, countByKind } from "./declared.mjs";
import {
  checkAbsentWhere,
  checkCoverage,
  checkNoBuildOutputs,
  checkNoLineNumbers,
  checkNoRawPipeInCode,
  checkPartialHasLimit,
  checkStates,
  extractPathClaims,
  parseLedger,
} from "./parse.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER_REL = "docs/feature-ledger.md";

/**
 * `checkCoverage` only asks whether a declared name appears *somewhere* in the
 * markdown, so a bare list of names would satisfy it without a single row being
 * written. The placeholder ledger needs exactly such a list to be green while
 * the body is unwritten — so the list is fenced by this marker, and every run
 * prints how many names are riding on it. A hollow pass that announces itself
 * is recoverable; a silent one is not.
 */
const BACKLOG_RE = /<!--\s*ledger:coverage-backlog\s*-->[\s\S]*?<!--\s*\/ledger:coverage-backlog\s*-->/g;

/** Every path claim must resolve against the working tree. */
function checkPathsResolve(claims) {
  return claims
    .filter((claim) => !fs.existsSync(path.join(REPO_ROOT, claim.path.replace(/:\d+$/, ""))))
    .map((claim) => ({
      severity: "error",
      rule: "path-resolves",
      message: `「在哪」指向的路径不存在：\`${claim.path}\``,
      lineNumber: claim.lineNumber,
    }));
}

function main() {
  const require_ = process.argv.includes("--require");
  const ledgerPath = path.join(REPO_ROOT, LEDGER_REL);

  if (!fs.existsSync(ledgerPath)) {
    console.log(
      `!! ${LEDGER_REL} 不存在 — 功能账簿闸门被跳过。` +
        `该文件已纳入 git 跟踪，正常情况下这一行永远不该出现。`,
    );
    process.exit(require_ ? 1 : 0);
  }

  const markdown = fs.readFileSync(ledgerPath, "utf8");
  const { rows } = parseLedger(markdown);
  const claims = extractPathClaims(rows);
  const declared = collectDeclaredNames(REPO_ROOT);

  const coverageFindings = checkCoverage(declared, markdown);
  const findings = [
    ...checkStates(rows),
    ...checkPartialHasLimit(rows),
    ...checkAbsentWhere(rows),
    ...checkNoLineNumbers(claims),
    ...checkNoBuildOutputs(claims),
    ...checkNoRawPipeInCode(markdown),
    ...checkPathsResolve(claims),
    ...coverageFindings,
  ];

  const covered = declared.length - coverageFindings.length;
  console.log(
    `${rows.length} rows, ${claims.length} path claims, ${findings.length} findings, ` +
      `${covered}/${declared.length} declared names covered`,
  );

  const counts = countByKind(declared);
  console.log(
    `declared: ${Object.entries(counts)
      .map(([kind, n]) => `${kind}=${n}`)
      .join("  ")}`,
  );

  if (BACKLOG_RE.test(markdown)) {
    const withoutBacklog = markdown.replace(BACKLOG_RE, "");
    const hollow = checkCoverage(declared, withoutBacklog).length - coverageFindings.length;
    console.log(
      `!! ${hollow} 个名字只靠「覆盖待办」清单通过 coverage，没有对应账簿行。` +
        `每写一行就从清单里删掉一个名字；清单清空后请删除整节。`,
    );
  }

  const sorted = [...findings].sort((a, b) => (a.lineNumber ?? 1e9) - (b.lineNumber ?? 1e9));
  for (const f of sorted) {
    const at = f.lineNumber === undefined ? "" : `:${f.lineNumber}`;
    console.log(`${LEDGER_REL}${at}  [${f.rule}] ${f.message}`);
  }

  process.exit(findings.length > 0 ? 1 : 0);
}

main();
