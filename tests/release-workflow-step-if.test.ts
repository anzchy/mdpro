// @vitest-environment node
/**
 * D128-WI-1: no step in a release-guarded job of `.github/workflows/release.yml`
 * carries a step-level `if:` (ADR-0073, "fail-closed at every step").
 *
 * W13 pins only the publish job's `if:`. A step-level `if: always()` (or
 * `failure()`, `cancelled()`, `!cancelled()`, `success() || …`) on the
 * verify-release, gate or `--draft=false` step would let that step run after an
 * earlier one failed, and every test in release-workflow-shape.test.ts would
 * still pass. W5 there already bans `continue-on-error`.
 *
 * Guarded jobs: `draft`, `publish`, and any job whose steps run verify-release.mjs,
 * verify-assets.mjs, gate.mjs or `gh release`. Two rules are pinned: the fail-open
 * rule (no always()/failure()/cancelled()/||) and the stricter one release.yml
 * already meets (no step-level `if:` at all in those jobs). The synthetic cases
 * prove the checker can fail, on every `if:` spelling it must read.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entry, job, steps } from "./support/workflowBlocks";
import { FAIL_OPEN, guardedJobs, stepIf, stepIfViolations } from "./support/workflowStepIf";

const FILE = path.resolve(__dirname, "..", ".github", "workflows", "release.yml");
const TEXT = fs.readFileSync(FILE, "utf8");

/** A one-job workflow whose `publish` job runs the gate step with `stepExtra` lines under it. */
const workflow = (stepExtra: string[], jobId = "publish") =>
  [
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    `  ${jobId}:`,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v6",
    "      - name: Gate the publish",
    ...stepExtra.map((l) => `        ${l}`),
    "        run: node scripts/release/gate.mjs may-publish --mode draft",
    "      - name: Publish",
    "        run: gh release edit v1 --draft=false",
    "",
  ].join("\n");

const FAIL_OPEN_CASES: Array<[string, string[]]> = [
  ["if: always()", ["if: always()"]],
  ["if: ${{ failure() }}", ["if: ${{ failure() }}"]],
  ['if: "!cancelled()"', ['if: "!cancelled()"']],
  ["multi-line if: >- with always()", ["if: >-", "  steps.verify_release.outcome == 'success'", "  && always()"]],
  ["if: | with failure()", ["if: |", "  failure()"]],
  ["if: ${{ success() || inputs.force }}", ["if: ${{ success() || inputs.force }}"]],
  ["single-quoted if: 'cancelled()'", ["if: 'cancelled()'"]],
  ["mixed-case Always ()", ["if: Always ()"]],
  ["if: with a trailing comment", ["if: always() # keep going"]],
];

describe("D128 the checker can fail (synthetic workflows)", () => {
  for (const [label, extra] of FAIL_OPEN_CASES) {
    it(`rejects a step-level ${label}, under both rules`, () => {
      const text = workflow(extra);
      for (const strict of [false, true]) {
        const v = stepIfViolations(text, { strict });
        expect(v, `strict=${strict}`).toHaveLength(1);
        expect(v[0]).toMatchObject({ job: "publish", step: 1, name: "Gate the publish" });
        if (!strict) expect(v[0].reason).toBe("fail-open");
      }
    });
  }

  it("rejects `if:` as the first key of a step item", () => {
    const text = workflow([]).replace("      - name: Publish\n", "      - if: always()\n        name: Publish\n");
    expect(stepIfViolations(text, { strict: false })).toMatchObject([{ job: "publish", step: 2, cond: "always()" }]);
  });

  it("accepts a clean workflow under both rules", () => {
    const text = workflow([]);
    expect(stepIfViolations(text, { strict: false })).toEqual([]);
    expect(stepIfViolations(text, { strict: true })).toEqual([]);
  });

  it("a benign step if: passes the fail-open rule but fails the strict one", () => {
    const text = workflow(["if: inputs.mode == 'draft'"]);
    expect(stepIfViolations(text, { strict: false })).toEqual([]);
    expect(stepIfViolations(text, { strict: true })).toMatchObject([{ step: 1, reason: "any-if" }]);
  });

  it("an `if` key nested under with: or env: is not the step's if:", () => {
    const text = workflow(["with:", "  if: always()", "env:", "  X: ${{ always() }}"]);
    expect(stepIfViolations(text, { strict: true })).toEqual([]);
  });

  it("guards a job by what it runs, not by its name", () => {
    const text = workflow(["if: always()"], "ship");
    expect(guardedJobs(text)).toEqual(["ship"]);
    expect(stepIfViolations(text, { strict: false })).toMatchObject([{ job: "ship" }]);
  });

  it("does not guard a job that runs none of the release commands", () => {
    const text = workflow(["if: always()"], "lint").replace(/node scripts\/release\/gate\.mjs[^\n]*/, "pnpm lint");
    const clean = text.replace("gh release edit v1 --draft=false", "echo done");
    expect(guardedJobs(clean)).toEqual([]);
    expect(stepIfViolations(clean, { strict: true })).toEqual([]);
  });

  it("stepIf reads inline, quoted, ${{ }}-wrapped and block-scalar forms", () => {
    expect(stepIf("name: a\nif: always()\nrun: x")).toBe("always()");
    expect(stepIf("name: a\nif: \"!cancelled()\"\nrun: x")).toBe("!cancelled()");
    expect(stepIf("name: a\nif: ${{ failure() }}\nrun: x")).toBe("${{ failure() }}");
    expect(stepIf("name: a\nif: >-\n  a &&\n  always()\nrun: x")).toBe("a &&\nalways()");
    expect(stepIf("name: a\nrun: x")).toBeNull();
  });

  it("FAIL_OPEN matches each fail-open status function and || but not plain conditions", () => {
    for (const c of ["always()", "failure()", "cancelled()", "!cancelled()", "success() || x", "${{ ALWAYS() }}"]) {
      expect(FAIL_OPEN.test(c), c).toBe(true);
    }
    for (const c of ["success()", "inputs.mode == 'draft'", "runner.os == 'macOS'", "steps.a.outcome == 'success'"]) {
      expect(FAIL_OPEN.test(c), c).toBe(false);
    }
  });
});

describe("D128 release.yml", () => {
  it("guards exactly verify, draft and publish", () => {
    expect(guardedJobs(TEXT)).toEqual(["verify", "draft", "publish"]);
  });

  it("the guarded jobs have steps to check (the pin is not vacuous)", () => {
    for (const id of ["draft", "publish"]) expect(steps(job(TEXT, id)).length, id).toBeGreaterThanOrEqual(5);
  });

  it("positive control: the checker reads the real step ifs of the unguarded build job", () => {
    const conds = steps(job(TEXT, "build")).map(stepIf).filter((c): c is string => c !== null);
    expect(conds).toContain("runner.os == 'macOS'");
    expect(conds).toContain("runner.os == 'Linux'");
  });

  it("no step in a guarded job has a fail-open if: (always/failure/cancelled/||)", () => {
    expect(stepIfViolations(TEXT, { strict: false })).toEqual([]);
  });

  it("stricter: no step in a guarded job has any step-level if:", () => {
    expect(stepIfViolations(TEXT, { strict: true })).toEqual([]);
  });

  // W7 bans `||` on draft's job-level if: but not always()/failure()/cancelled(),
  // so `if: always() && inputs.mode != 'build-only'` passed every test. Pin the
  // job level for every guarded job, and prove the reader sees a job's own if:.
  it("no guarded job has a fail-open job-level if:, and verify has none at all", () => {
    const jobIf = (text: string, id: string) => {
      const e = entry(job(text, id), "if");
      return e ? (e.inline ?? e.body) : null;
    };
    const bad = workflow([]).replace("  publish:\n", "  publish:\n    if: always() && inputs.mode == 'draft'\n");
    expect(jobIf(bad, "publish")).toMatch(FAIL_OPEN);
    for (const id of guardedJobs(TEXT)) expect(jobIf(TEXT, id) ?? "", id).not.toMatch(FAIL_OPEN);
    expect(jobIf(TEXT, "draft")).toBe("inputs.mode != 'build-only'");
    expect(jobIf(TEXT, "verify")).toBeNull();
  });
});
