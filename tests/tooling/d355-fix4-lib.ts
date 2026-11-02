// D355 fix 4: helpers for d355-fix4-props.test.ts. No permanent test may read a git object outside the checked-out
// tree; these hold the D355 files to that, calibrate the superseded-phrase scanner on recorded text, and keep the D302
// exceptions file free of D355 entries.
import fs from "node:fs";

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

const REF = ".agents/skills/mdpro-delegator/references";
/**
 * The superseded-phrase sites at the fix-1 candidate 98de0c69, one per site: lines n..n+2 of that revision, verbatim
 * (roster-and-routing.md blob 1d3a2ddb, landing-and-audit.md blob 5d3170f4). Recorded text, so the scanner's calibration
 * needs no git; the D355 fix-4 one-shot checks each snippet against the blob.
 */
export const CANDIDATE_SITES: Readonly<Record<string, string>> = {
  [`${REF}/roster-and-routing.md:20`]: "- the two-auditor requirement: `gpt-auditor` is required; `opus-auditor` is optional only\n  under the Claude delegator route below.\n",
  [`${REF}/roster-and-routing.md:53`]: "`gpt-auditor` remains the required auditor in both routes. The user's 2026-10-24\n「opus-auditor has exited, from now on, only rely on gpt-auditor」 retires Opus\nfor the Codex route. Under the later user direction, a Claude delegator may",
  [`${REF}/roster-and-routing.md:56`]: "add `opus-auditor` **only when the user explicitly requests it and available\nClaude usage is sufficient**. The request records both facts. Its report is\nan additional independent verdict, never a substitute for `gpt-auditor`; an",
  [`${REF}/roster-and-routing.md:72`]: "| Optional auditor, Claude route only | `opus-auditor` | Claude, only after the user's explicit request and a sufficient usage check | a fresh request recording both conditions | its report, then idle; absent otherwise |\n| High-tier security reviewer | `gpt-auditor` | Codex, in the same fresh-pane audit request | the High-tier request names security dimensions, unless policy-only (§ Which set) | security count in its report |\n| Landing verifier | herdr-delegator on Codex; `mdpro-landing-verifier` subagent on Claude | the same lane, receipt, ancestry and tree checks | after handoff | verification record under `herdr-spike/delegator/` |",
  [`${REF}/landing-and-audit.md:121`]: "       one finding (Fable in `challenge` mode, Codex by `/cc-suite:continue`\n       on its thread) and returns CONFIRMED or REFUTED. A refutation needs a\n       reproduction or a counter-proof. Without one, the finding stands.",
  [`${REF}/landing-and-audit.md:149`]: "   re-checks by tree identity, and the delegator lands. **At most three\n   rounds**: the first audit and two confirms\n   ([ADR-0120](../../../../docs/adr/0120-a-pre-landing-audit-runs-at-most-three-rounds-then-the-user-rules.md);",
  [`${REF}/landing-and-audit.md:150`]: "   rounds**: the first audit and two confirms\n   ([ADR-0120](../../../../docs/adr/0120-a-pre-landing-audit-runs-at-most-three-rounds-then-the-user-rules.md);\n   user decision, 2026-10-17: 「规定以后codex audit最多2个round」, settled as",
  [`${REF}/landing-and-audit.md:153`]: "   「Audit + 2 confirms」 for both auditors). A Critical or High still open after\n   round three gets no fourth round. The delegator brings it to the user, who\n   rules, and the ruling is quoted in the row.",
  [`${REF}/landing-and-audit.md:154`]: "   round three gets no fourth round. The delegator brings it to the user, who\n   rules, and the ruling is quoted in the row.\n",
  [`${REF}/landing-and-audit.md:232`]: "  Optional `opus-auditor` follows § Delegator runtime route; it never replaces\n  this required request.\n- **Round one is blind to PR comments and delegator conclusions.** `gpt-auditor` writes its report;",
  [`${REF}/landing-and-audit.md:236`]: "  single-auditor verdict unless the optional Opus audit ran; then it merges both reports.\n  Any blocking Critical or High stays open until a scoped gpt-auditor confirm closes it.\n- **ADRs and plans.** Reviewed only as rule 70 item 4 \"ADRs and plans\" says",
  [`${REF}/landing-and-audit.md:267`]: "- **Opus is never required.** On Codex do not reset, prompt or wait for `opus-auditor`.\n  On Claude, dispatch it only under the two conditions in § Delegator runtime route.\n  Earlier Opus reports remain evidence for the rounds in which they were completed.",
};

/** The D355 files a D302 exceptions file (a JSON array of `{ file, reason }`) names; throws on any other shape. */
export function d355Exceptions(file: string): string[] {
  const entries: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(entries)) throw new Error(`${file}: not an array of exception entries`);
  return entries.map((e: unknown, i) => {
    const name = (e as { file?: unknown } | null)?.file;
    if (typeof name !== "string") throw new Error(`${file}: entry ${i} has no file`);
    return name;
  }).filter((f) => D355_TEST_FILES.includes(f) || f.startsWith("tests/tooling/d355-"));
}
