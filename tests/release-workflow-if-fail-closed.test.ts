// @vitest-environment node
/**
 * D128-WI-2: the release-guarded `if:` checker fails closed.
 *
 * workflowBlocks is a line-based reader, not a YAML parser. Audit b38 found
 * step spellings it reads as "no if:" that a real YAML parser decodes to a
 * fail-open condition: (A) a flow-mapped step `- {if: always(), ...}`, (B) a
 * quoted or escaped key (`"if":`, `'if':`, `"\x69f":`), and (C) an `if:` value
 * it cannot decode with certainty (a quoted value with a backslash escape, a
 * flow value, or a scalar that continues past its line). Inside a guarded job
 * each of those is now an `unparseable` violation, under both rules; outside a
 * guarded job nothing changes. Every form WI-1 accepts keeps its WI-1 reading.
 *
 * Also holds the job-level `if:` pin (moved here from
 * release-workflow-step-if.test.ts, so that file stays as its receipt recorded it).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entry, job, steps } from "./support/workflowBlocks";
import { FAIL_OPEN, guardedJobs, stepIfViolations } from "./support/workflowStepIf";

const FILE = path.resolve(__dirname, "..", ".github", "workflows", "release.yml");
const TEXT = fs.readFileSync(FILE, "utf8");

/** A one-job workflow: a checkout step, then `stepLines` (written at step-item indent), then a clean publish step. */
const wf = (stepLines: string[], jobId = "publish", lastRun = "gh release edit v1 --draft=false") =>
  [
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    `  ${jobId}:`,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v6",
    ...stepLines.map((l) => `      ${l}`),
    "      - name: Publish",
    `        run: ${lastRun}`,
    "",
  ].join("\n");

const GATE = "node scripts/release/gate.mjs may-publish --mode draft";

/** Each obscured step shape the line reader cannot certify, as lines at step-item indent. */
const UNPARSEABLE: Array<[string, string[]]> = [
  // (A) flow-mapped steps
  ["A: flow-mapped step with if: always()", [`- {if: always(), name: Gate, run: ${GATE}}`]],
  ["A: flow-mapped step with no visible if:", [`- {name: Gate, run: ${GATE}}`]],
  // (B) quoted keys
  ['B: double-quoted "if": key', ["- name: Gate", '  "if": always()', `  run: ${GATE}`]],
  ["B: single-quoted 'if': key", ["- name: Gate", "  'if': always()", `  run: ${GATE}`]],
  ['B: escaped "\\x69f": key', ["- name: Gate", '  "\\x69f": always()', `  run: ${GATE}`]],
  ["B: quoted key on the item line", ['- "if": always()', "  name: Gate", `  run: ${GATE}`]],
  ['B: any quoted key ("name":)', ['- "name": Gate', `  run: ${GATE}`]],
  ["B: complex key ? if", ["- name: Gate", "  ? if", "  : always()", `  run: ${GATE}`]],
  // (C) if: values the extractor cannot decode with certainty
  ['C: double-quoted value with a \\u escape', ["- name: Gate", '  if: "always\\u0028)"', `  run: ${GATE}`]],
  ["C: single-quoted value with a backslash", ["- name: Gate", "  if: 'always\\()'", `  run: ${GATE}`]],
  ["C: double-quoted value spanning lines", ["- name: Gate", '  if: "inputs.a &&', '    always()"', `  run: ${GATE}`]],
  ["C: single-quoted value spanning lines", ["- name: Gate", "  if: 'inputs.a &&", "    always()'", `  run: ${GATE}`]],
  ["C: plain value spanning lines", ["- name: Gate", "  if: inputs.a &&", "    always()", `  run: ${GATE}`]],
  ["C: flow-sequence value", ["- name: Gate", "  if: [always()]", `  run: ${GATE}`]],
  ["C: flow-mapping value", ["- name: Gate", "  if: {a: always()}", `  run: ${GATE}`]],
  ["C: block scalar with a comment on its indicator", ["- name: Gate", "  if: >- # why", "    always()", `  run: ${GATE}`]],
];

describe("D128-WI-2 the checker fails closed in a guarded job", () => {
  for (const [label, lines] of UNPARSEABLE) {
    it(`reports ${label} as unparseable, under both rules`, () => {
      const text = wf(lines);
      for (const strict of [false, true]) {
        const v = stepIfViolations(text, { strict });
        expect(v, `strict=${strict}`).toHaveLength(1);
        expect(v[0], `strict=${strict}`).toMatchObject({ job: "publish", step: 1, reason: "unparseable" });
      }
    });
  }

  it("a flow-mapped step that runs the gate makes its job guarded, whatever the job is called", () => {
    const text = wf([`- {if: always(), run: ${GATE}}`], "ship", "echo done");
    expect(guardedJobs(text)).toEqual(["ship"]);
    expect(stepIfViolations(text, { strict: false })).toMatchObject([{ job: "ship", step: 1, reason: "unparseable" }]);
  });

  it("does not report the same shapes in an unguarded job", () => {
    for (const [label, lines] of UNPARSEABLE) {
      const text = wf(lines.map((l) => l.replace(GATE, "pnpm lint")), "build", "echo done");
      expect(guardedJobs(text), label).toEqual([]);
      expect(stepIfViolations(text, { strict: true }), label).toEqual([]);
    }
  });

  it("monotone: obscuring a step never yields fewer violations than its plain spelling", () => {
    for (const cond of ["always()", "inputs.mode == 'draft'", "failure()", "success()"]) {
      const plain = wf(["- name: Gate", `  if: ${cond}`, `  run: ${GATE}`]);
      const obscured = [
        wf([`- {name: Gate, if: ${cond}, run: ${GATE}}`]),
        wf(["- name: Gate", `  "if": ${cond}`, `  run: ${GATE}`]),
        wf(["- name: Gate", `  if: "\\${cond}"`, `  run: ${GATE}`]),
      ];
      for (const strict of [false, true]) {
        const base = stepIfViolations(plain, { strict }).length;
        for (const o of obscured) expect(stepIfViolations(o, { strict }).length, `${cond} strict=${strict}`).toBeGreaterThanOrEqual(Math.max(base, 1));
      }
    }
  });
});

describe("D128-WI-2 the forms WI-1 accepts keep their reading", () => {
  it("plain, quoted, ${{ }} and block-scalar if: values are read, not called unparseable", () => {
    const cases: Array<[string[], string, string]> = [
      [["if: always()"], "always()", "fail-open"],
      [['if: "!cancelled()"'], "!cancelled()", "fail-open"],
      [["if: 'cancelled()'"], "cancelled()", "fail-open"],
      [["if: ${{ failure() }}"], "${{ failure() }}", "fail-open"],
      [["if: always() # keep going"], "always()", "fail-open"],
      [["if: >-", "  a &&", "  always()"], "a &&\nalways()", "fail-open"],
      [["if: inputs.mode == 'draft'"], "inputs.mode == 'draft'", "any-if"],
    ];
    for (const [extra, cond, reason] of cases) {
      const text = wf(["- name: Gate", ...extra.map((l) => `  ${l}`), `  run: ${GATE}`]);
      expect(stepIfViolations(text, { strict: true }), cond).toMatchObject([{ step: 1, cond, reason }]);
    }
  });

  it("a quoted key or backslash nested under with: or env: is not the step's own key", () => {
    const text = wf(["- name: Gate", "  with:", '    "if": always()', "  env:", '    X: "a\\tb"', `  run: ${GATE}`]);
    expect(stepIfViolations(text, { strict: true })).toEqual([]);
  });

  it("a clean step with no if: is still clean", () => {
    expect(stepIfViolations(wf(["- name: Gate", `  run: ${GATE}`]), { strict: true })).toEqual([]);
  });
});

describe("D128-WI-2 release.yml", () => {
  it("has no unparseable step in a guarded job, and the guarded jobs have steps to check", () => {
    const all = stepIfViolations(TEXT, { strict: true });
    expect(all.filter((v) => v.reason === "unparseable")).toEqual([]);
    expect(all).toEqual([]);
    for (const id of guardedJobs(TEXT)) expect(steps(job(TEXT, id)).length, id).toBeGreaterThanOrEqual(5);
  });

  // W7 bans `||` on draft's job-level if: but not always()/failure()/cancelled(),
  // so `if: always() && inputs.mode != 'build-only'` passed every test. Pin the
  // job level for every guarded job, and prove the reader sees a job's own if:.
  it("no guarded job has a fail-open job-level if:, and verify has none at all", () => {
    const jobIf = (text: string, id: string) => {
      const e = entry(job(text, id), "if");
      return e ? (e.inline ?? e.body) : null;
    };
    const bad = wf([]).replace("  publish:\n", "  publish:\n    if: always() && inputs.mode == 'draft'\n");
    expect(jobIf(bad, "publish")).toMatch(FAIL_OPEN);
    for (const id of guardedJobs(TEXT)) expect(jobIf(TEXT, id) ?? "", id).not.toMatch(FAIL_OPEN);
    expect(jobIf(TEXT, "draft")).toBe("inputs.mode != 'build-only'");
    expect(jobIf(TEXT, "verify")).toBeNull();
  });
});
