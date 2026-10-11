/**
 * D128: step-level `if:` checker for release-guarded jobs in a GitHub workflow.
 *
 * A guarded job is `draft`, `publish`, or any job with a step whose `run:` calls
 * verify-release.mjs, verify-assets.mjs, gate.mjs or `gh release`. Steps are
 * found per job through workflowBlocks (`steps:` items, so `- name:`, `- run:`,
 * `- uses:` and `- if:` items alike), and each step's own base-level `if:` key
 * is read in every form the extractor knows: plain, quoted, `${{ }}`-wrapped,
 * with a trailing comment, or a `>` / `|` block scalar. An `if` nested under
 * `with:` or `env:` is not the step's condition.
 *
 * Fail-closed (D128-WI-2): workflowBlocks is line-based, not a YAML parser, so a
 * step it cannot read with certainty is an `unparseable` violation in a guarded
 * job, never "no if:" — a flow-mapped step (`- {…}`), any quoted or complex key
 * at the step's own level, or an `if:` value that is quoted with a backslash,
 * a flow value, or continues past its line. Such a step's raw text also counts
 * when deciding whether its job is guarded. A comment line inside a step that sits
 * left of the step's keys is `unparseable` too (D128-WI-3). Pinned by
 * tests/release-workflow-step-if.test.ts, tests/release-workflow-if-fail-closed.test.ts
 * and tests/release-workflow-if-comment-indent.test.ts.
 */
import { entry, job, jobIds, stepRun, steps } from "./workflowBlocks";

export interface StepIfViolation {
  job: string;
  /** 0-based index of the step in the job's `steps:`. */
  step: number;
  name: string;
  /** The condition read, or, for `unparseable`, why the step could not be read. */
  cond: string;
  /**
   * `fail-open`: runs after an earlier failure or cancel; `any-if`: the strict
   * rule's catch-all; `unparseable`: the step's `if:` cannot be read with certainty.
   */
  reason: "fail-open" | "any-if" | "unparseable";
}

/** A status function that runs after a failure or cancel, or an `||` that can bypass success(). */
export const FAIL_OPEN = /\b(?:always|failure|cancelled)\s*\(|\|\|/i;

const GUARDED_NAMES = new Set(["draft", "publish"]);
const GUARDED_RUN = /scripts\/release\/(?:verify-release|verify-assets|gate)\.mjs|\bgh\s+release\b/;
/** An unquoted block-map key line at the step's own level. */
const PLAIN_KEY_LINE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\s*:(?:\s|$)/;
const IF_LINE = /^if\s*:(.*)$/;

/** A step's own `if:` condition (inline or block-scalar body), or null when it has none. */
export function stepIf(step: string): string | null {
  const e = entry(step, "if");
  if (!e) return null;
  return e.inline ?? e.body;
}

const isComment = (l: string) => l.trimStart().startsWith("#");
const leadOf = (l: string) => l.length - l.trimStart().length;

/**
 * Why a (dedented) step's own `if:` cannot be read with certainty, or null when it can.
 * The key indent comes from non-comment lines only (D128-WI-3): `items()` dedents by
 * comments too, so a comment left of the keys would otherwise hide every key.
 */
export function unparseableReason(step: string): string | null {
  const lines = step.split(/\r?\n/).filter((l) => l.trim() !== "");
  const keyLines = lines.filter((l) => !isComment(l));
  const keyIndent = keyLines.length ? Math.min(...keyLines.map(leadOf)) : 0;
  const under = lines.find((l) => isComment(l) && leadOf(l) < keyIndent);
  if (under !== undefined) return `comment indented less than the step's keys: ${under.trim()}`;
  let rawIf: string | null = null;
  for (const line of keyLines) {
    if (leadOf(line) !== keyIndent) continue;
    const l = line.slice(keyIndent);
    if (!PLAIN_KEY_LINE.test(l)) return `not a plain key line: ${l}`;
    const m = IF_LINE.exec(l);
    if (m) rawIf = m[1].trim();
  }
  if (rawIf === null) return null;
  if (/^["']/.test(rawIf) && rawIf.includes("\\")) return `quoted if: with a backslash: ${rawIf}`;
  if (/^[[{]/.test(rawIf)) return `flow if: value: ${rawIf}`;
  try {
    const e = entry(step, "if");
    if (e && e.inline !== null && e.body !== "") return `if: continues past its line: ${rawIf}`;
    if (e?.inline && /^["']/.test(rawIf) && e.inline[0] === rawIf[0]) return `unterminated quoted if: ${rawIf}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/** Job ids, in file order, whose steps must not carry a fail-open (or, strictly, any) `if:`. */
export function guardedJobs(text: string): string[] {
  return jobIds(text).filter(
    (id) =>
      GUARDED_NAMES.has(id) ||
      steps(job(text, id)).some((s) => GUARDED_RUN.test(unparseableReason(s) !== null ? s : (stepRun(s) ?? ""))),
  );
}

/** A step's `name:`, or "" when it has none or it cannot be read. */
function stepName(step: string): string {
  try {
    return entry(step, "name")?.inline ?? "";
  } catch {
    return "";
  }
}

/** Every step-level `if:` in a guarded job that breaks the rule (`strict`: any `if:` at all). */
export function stepIfViolations(text: string, opts: { strict: boolean }): StepIfViolation[] {
  const out: StepIfViolation[] = [];
  for (const id of guardedJobs(text)) {
    steps(job(text, id)).forEach((s, i) => {
      const name = stepName(s);
      const why = unparseableReason(s);
      if (why !== null) {
        out.push({ job: id, step: i, name, cond: why, reason: "unparseable" });
        return;
      }
      const cond = stepIf(s);
      if (cond === null) return;
      const failOpen = FAIL_OPEN.test(cond);
      if (!failOpen && !opts.strict) return;
      out.push({ job: id, step: i, name, cond, reason: failOpen ? "fail-open" : "any-if" });
    });
  }
  return out;
}
