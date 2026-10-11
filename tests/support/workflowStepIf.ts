/**
 * D128: step-level `if:` checker for release-guarded jobs in a GitHub workflow.
 *
 * A guarded job is `draft`, `publish`, or any job with a step whose `run:` calls
 * verify-release.mjs, verify-assets.mjs, gate.mjs or `gh release`. Steps are
 * found per job through workflowBlocks (`steps:` items, so `- name:`, `- run:`,
 * `- uses:` and `- if:` items alike), and each step's own base-level `if:` key
 * is read in every form the extractor knows: plain, quoted, `${{ }}`-wrapped,
 * with a trailing comment, or a `>` / `|` block scalar. An `if` nested under
 * `with:` or `env:` is not the step's condition. Pinned by
 * tests/release-workflow-step-if.test.ts.
 */
import { entry, job, jobIds, stepRun, steps } from "./workflowBlocks";

export interface StepIfViolation {
  job: string;
  /** 0-based index of the step in the job's `steps:`. */
  step: number;
  name: string;
  cond: string;
  /** `fail-open`: runs after an earlier failure or cancel; `any-if`: the strict rule's catch-all. */
  reason: "fail-open" | "any-if";
}

/** A status function that runs after a failure or cancel, or an `||` that can bypass success(). */
export const FAIL_OPEN = /\b(?:always|failure|cancelled)\s*\(|\|\|/i;

const GUARDED_NAMES = new Set(["draft", "publish"]);
const GUARDED_RUN = /scripts\/release\/(?:verify-release|verify-assets|gate)\.mjs|\bgh\s+release\b/;

/** A step's own `if:` condition (inline or block-scalar body), or null when it has none. */
export function stepIf(step: string): string | null {
  const e = entry(step, "if");
  if (!e) return null;
  return e.inline ?? e.body;
}

/** Job ids, in file order, whose steps must not carry a fail-open (or, strictly, any) `if:`. */
export function guardedJobs(text: string): string[] {
  return jobIds(text).filter(
    (id) => GUARDED_NAMES.has(id) || steps(job(text, id)).some((s) => GUARDED_RUN.test(stepRun(s) ?? "")),
  );
}

/** Every step-level `if:` in a guarded job that breaks the rule (`strict`: any `if:` at all). */
export function stepIfViolations(text: string, opts: { strict: boolean }): StepIfViolation[] {
  const out: StepIfViolation[] = [];
  for (const id of guardedJobs(text)) {
    steps(job(text, id)).forEach((s, i) => {
      const cond = stepIf(s);
      if (cond === null) return;
      const failOpen = FAIL_OPEN.test(cond);
      if (!failOpen && !opts.strict) return;
      const name = entry(s, "name")?.inline ?? "";
      out.push({ job: id, step: i, name, cond, reason: failOpen ? "fail-open" : "any-if" });
    });
  }
  return out;
}
