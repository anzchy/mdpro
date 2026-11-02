// D355 fix 4: helpers for d355-fix4-props.test.ts. No permanent test may read a git object outside the checked-out
// tree; these hold the D355 files to that, calibrate the superseded-phrase scanner on recorded text, and keep the D302
// exceptions file free of D355 entries.

/** The test files and libs D355 added under tests/tooling, plus gh586 (whose git read D355 added). */
export const D355_TEST_FILES: readonly string[] = [
  "always-on-budget.test.ts", "codex-land-guard-export.test.ts", "d355-fix1-fx1.test.ts", "d355-fix1-fx2.test.ts",
  "d355-fix1-fx3.test.ts", "d355-fix1-lib.ts", "d355-fix1-shoulds.test.ts", "d355-fix3-lint.test.ts",
  "d355-r3-history.test.ts", "d355-r3-homes.test.ts", "gh586-audit-policy-split.test.ts", "rule-citations-lib.test.ts",
  "rule-citations-lib.ts", "rule-citations.test.ts", "rules-budget-caps.test.ts", "rules-budget-fixture.ts",
  "rules-budget-lib-edges.test.ts", "rules-budget-lib.test.ts", "rules-budget-lib.ts", "rules-lib-core.ts",
].map((f) => `tests/tooling/${f}`);

/** git verbs that read history or objects beyond the working tree's own HEAD listing. */
const HISTORY_VERBS = new Set(["show", "cat-file", "diff", "log", "archive", "rev-parse", "merge-base"]);

/** 1-based line numbers whose literal `"git"` call passes a history-reading verb in its argv array. */
export function historyReads(text: string): number[] {
  const out: number[] = [];
  text.split("\n").forEach((line, i) => {
    const call = /"git"\s*,\s*\[([^\]]*)/.exec(line);
    if (!call) return;
    const argv = [...call[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (argv.some((a) => HISTORY_VERBS.has(a))) out.push(i + 1);
  });
  return out;
}

/** RED stub. */
export const CANDIDATE_SITES: Readonly<Record<string, string>> = {};

/** RED stub. */
export function d355Exceptions(file: string): string[] {
  void file;
  return [];
}
