// @vitest-environment node
/**
 * D128-WI-3: an under-indented comment inside a guarded step fails closed.
 *
 * Audit b45 (Medium): `items()` dedents a step by the smallest indentation of
 * any non-blank line, comments included. A comment line indented less than the
 * step's keys therefore left every key with leading spaces, the key scan in
 * `unparseableReason` skipped them all, and an escaped `"\x69f": always()` key
 * went unreported in both rules. The step's key indentation now comes from
 * non-comment lines only, and a comment inside a guarded step that sits left of
 * the keys is itself `unparseable`. Comments at or deeper than the keys,
 * trailing comments, and a comment between two steps keep their reading.
 *
 * A new file so the D128-WI-1 and WI-2 recorded test files stay as recorded.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guardedJobs, stepIfViolations } from "../support/workflowStepIf";
import { job, steps } from "../support/workflowBlocks";

const FILE = path.resolve(__dirname, "..", "..", ".github", "workflows", "release.yml");
const TEXT = fs.readFileSync(FILE, "utf8");

/** A one-job workflow: checkout, then `stepLines` (written at step-item indent), then a clean final step. */
const wf = (stepLines: string[], jobId = "publish", lastRun = "echo done") =>
  [
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    `  ${jobId}:`,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v6",
    ...stepLines.map((l) => `      ${l}`),
    "      - name: Done",
    `        run: ${lastRun}`,
    "",
  ].join("\n");

const PUBLISH_RUN = "gh release edit v1 --draft=false";
const ESCAPED_KEY = '"\\x69f": always()';
const BOTH = [false, true];

describe("D128-WI-3 an under-indented comment cannot hide a step's keys", () => {
  it("the audit reproduction on a copy of release.yml is reported as unparseable, under both rules", () => {
    const anchor = "      - name: Publish (the one publish call)\n";
    expect(TEXT.includes(anchor)).toBe(true);
    const mutated = TEXT.replace(anchor, `${anchor}        ${ESCAPED_KEY}\n      # neutral\n`);
    for (const strict of BOTH) {
      const v = stepIfViolations(mutated, { strict });
      expect(v, `strict=${strict}`).toHaveLength(1);
      expect(v[0], `strict=${strict}`).toMatchObject({ job: "publish", reason: "unparseable" });
      expect(v[0].name, `strict=${strict}`).toBe("Publish (the one publish call)");
    }
  });

  it("the audit reproduction as a synthetic guarded step is reported as unparseable, under both rules", () => {
    const text = wf(["- name: Publish", `  ${ESCAPED_KEY}`, "# neutral", `  run: ${PUBLISH_RUN}`]);
    expect(guardedJobs(text)).toEqual(["publish"]);
    for (const strict of BOTH) {
      expect(stepIfViolations(text, { strict }), `strict=${strict}`).toMatchObject([
        { job: "publish", step: 1, name: "Publish", reason: "unparseable" },
      ]);
    }
  });

  it("with the comment at key indent, the escaped key is still read and reported through WI-2's quoted-key rule", () => {
    const text = wf(["- name: Publish", `  ${ESCAPED_KEY}`, "  # neutral", `  run: ${PUBLISH_RUN}`]);
    for (const strict of BOTH) {
      expect(stepIfViolations(text, { strict }), `strict=${strict}`).toEqual([
        { job: "publish", step: 1, name: "Publish", cond: `not a plain key line: ${ESCAPED_KEY}`, reason: "unparseable" },
      ]);
    }
  });

  it("a benign guarded step with an under-indented comment is pinned as unparseable (fail closed)", () => {
    const text = wf(["- name: Publish", "# neutral", `  run: ${PUBLISH_RUN}`]);
    for (const strict of BOTH) {
      const v = stepIfViolations(text, { strict });
      expect(v, `strict=${strict}`).toHaveLength(1);
      expect(v[0], `strict=${strict}`).toMatchObject({ job: "publish", step: 1, name: "Publish", reason: "unparseable" });
      expect(v[0].cond, `strict=${strict}`).toMatch(/comment/i);
      expect(v[0].cond, `strict=${strict}`).toContain("# neutral");
    }
  });

  it("an under-indented comment deeper than the item dash but left of the keys is also unparseable", () => {
    const text = wf(["- name: Publish", " # neutral", `  run: ${PUBLISH_RUN}`]);
    expect(stepIfViolations(text, { strict: false })).toMatchObject([{ step: 1, reason: "unparseable" }]);
  });

  it("a plain if: always() next to an under-indented comment is never reported as fewer than one violation", () => {
    const text = wf(["- name: Publish", "  if: always()", "# neutral", `  run: ${PUBLISH_RUN}`]);
    for (const strict of BOTH) expect(stepIfViolations(text, { strict }).length, `strict=${strict}`).toBe(1);
  });

  it("does not report an under-indented comment in an unguarded job", () => {
    const text = wf(["- name: Lint", `  ${ESCAPED_KEY}`, "# neutral", "  run: pnpm lint"], "build");
    expect(guardedJobs(text)).toEqual([]);
    expect(stepIfViolations(text, { strict: true })).toEqual([]);
  });
});

describe("D128-WI-3 accepted comment forms keep their reading", () => {
  const CLEAN: Array<[string, string[]]> = [
    ["a comment at key indent", ["- name: Publish", "  # why", `  run: ${PUBLISH_RUN}`]],
    ["a comment deeper than the keys", ["- name: Publish", "  env:", "    # why", "    A: b", `  run: ${PUBLISH_RUN}`]],
    ["a trailing comment on a key line", ["- name: Publish # why", `  run: ${PUBLISH_RUN} # why`]],
    ["a # line inside a run: block scalar", ["- name: Publish", "  run: |", "    # set up", `    ${PUBLISH_RUN}`]],
    ["a comment between two steps at item indent", ["- name: Publish", `  run: ${PUBLISH_RUN}`, "# next step"]],
    ["a comment between two steps after a blank line", ["- name: Publish", `  run: ${PUBLISH_RUN}`, "", "# next"]],
  ];
  for (const [label, lines] of CLEAN) {
    it(`${label} is clean under the strict rule`, () => {
      const text = wf(lines);
      expect(guardedJobs(text)).toEqual(["publish"]);
      expect(stepIfViolations(text, { strict: true })).toEqual([]);
    });
  }

  it("an if: with a comment at key indent is still read as its condition", () => {
    const text = wf(["- name: Publish", "  # why", "  if: always() # keep going", `  run: ${PUBLISH_RUN}`]);
    expect(stepIfViolations(text, { strict: false })).toEqual([
      { job: "publish", step: 1, name: "Publish", cond: "always()", reason: "fail-open" },
    ]);
  });
});

describe("D128-WI-3 release.yml", () => {
  it("has no comment left of a guarded step's keys, and stays clean under the strict rule", () => {
    for (const id of guardedJobs(TEXT)) {
      steps(job(TEXT, id)).forEach((s, i) => {
        const lines = s.split("\n").filter((l) => l.trim() !== "");
        const keyIndent = Math.min(...lines.filter((l) => !l.trimStart().startsWith("#")).map((l) => l.search(/\S/)));
        const under = lines.filter((l) => l.trimStart().startsWith("#") && l.search(/\S/) < keyIndent);
        expect(under, `${id} step ${i}`).toEqual([]);
      });
    }
    expect(stepIfViolations(TEXT, { strict: true })).toEqual([]);
  });
});
