// @vitest-environment node
/**
 * Purpose: E2E-WI-1, the history rules of the journey gate (`history.mjs`):
 * REGISTRY.md only grows, journey files are never deleted, case ids are never
 * removed or reused, and the base they are compared against resolves the
 * plan's §4.8 way for a pull request, a `v*` tag, a manual dispatch and a local
 * run, failing (never skipping) when it cannot or when it equals HEAD.
 *
 * The tag and dispatch resolutions are proved here by unit test; their live CI
 * runs are the delegator's after landing (ruling Q-b, 2026-10-15).
 *
 * @module tests/tooling/journeys-history.test
 * @coordinates-with scripts/journeys/history.mjs
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { checkHistory, resolveBase } from "../../scripts/journeys/history.mjs";
import { git, journeyMd, registryMd, repoWithBase, validMeta, writeFiles, type Meta } from "../support/journeysFixture";

interface Finding {
  rule: string;
  message: string;
}

const J = "tests/journeys";
const file = (m: Meta) => `${J}/${String(m.id)}-x.md`;

function base(journeys: Meta[]) {
  const files: Record<string, string> = { [`${J}/REGISTRY.md`]: registryMd(journeys.map((m) => String(m.id))) };
  for (const m of journeys) files[file(m)] = journeyMd(m);
  return repoWithBase(files);
}

const rules = (root: string, baseSha: string) => (checkHistory(root, baseSha) as Finding[]).map((f) => f.rule);

describe("checkHistory", () => {
  it("an unchanged catalogue, or one that only grew, has no findings", () => {
    const { root, baseSha } = base([validMeta()]);
    expect(checkHistory(root, baseSha)).toEqual([]);
    const two = validMeta({ id: "EJ-002" });
    writeFiles(root, { [`${J}/REGISTRY.md`]: registryMd(["EJ-001", "EJ-002"]), [file(two)]: journeyMd(two) });
    expect(checkHistory(root, baseSha)).toEqual([]);
  });

  it("a row removed from REGISTRY.md is a finding", () => {
    const { root, baseSha } = base([validMeta(), validMeta({ id: "EJ-002" })]);
    writeFiles(root, { [`${J}/REGISTRY.md`]: registryMd(["EJ-001"]) });
    expect(rules(root, baseSha)).toContain("journey-registry-shrank");
  });

  it("a deleted journey file is a finding", () => {
    const { root, baseSha } = base([validMeta(), validMeta({ id: "EJ-002" })]);
    fs.rmSync(path.join(root, file(validMeta({ id: "EJ-002" }))));
    expect(rules(root, baseSha)).toContain("journey-file-deleted");
  });

  it("a renamed journey file is not a deletion", () => {
    const { root, baseSha } = base([validMeta()]);
    fs.renameSync(path.join(root, file(validMeta())), path.join(root, `${J}/EJ-001-renamed.md`));
    expect(checkHistory(root, baseSha)).toEqual([]);
  });

  it("a case removed from a journey is a finding (retire it instead)", () => {
    const m = validMeta({ cases: [{ id: "C1", intended: "x" }, { id: "C2", intended: "y" }] });
    const { root, baseSha } = base([m]);
    writeFiles(root, { [file(m)]: journeyMd({ ...m, cases: [{ id: "C1", intended: "x" }] }) });
    expect(rules(root, baseSha)).toContain("journey-case-removed");
  });

  it("a retired case brought back to life is a finding", () => {
    const m = validMeta({ cases: [{ id: "C1", intended: "x" }, { id: "C2", intended: "y", status: "retired" }] });
    const { root, baseSha } = base([m]);
    const revived = { ...m, cases: [{ id: "C1", intended: "x" }, { id: "C2", intended: "new meaning" }] };
    writeFiles(root, { [file(m)]: journeyMd(revived) });
    expect(rules(root, baseSha)).toContain("journey-case-reused");
  });

  it("retiring a case is allowed", () => {
    const m = validMeta({ cases: [{ id: "C1", intended: "x" }, { id: "C2", intended: "y" }] });
    const { root, baseSha } = base([m]);
    const retired = { ...m, cases: [{ id: "C1", intended: "x" }, { id: "C2", intended: "y", status: "retired" }] };
    writeFiles(root, { [file(m)]: journeyMd(retired) });
    expect(checkHistory(root, baseSha)).toEqual([]);
  });

  it("a base that git cannot resolve is a finding, not a skip", () => {
    const { root } = base([validMeta()]);
    expect(rules(root, "0".repeat(40))).toEqual(["journey-base"]);
  });

  it("a base in a repo whose catalogue did not exist yet compares as empty", () => {
    const { root, baseSha } = repoWithBase({ "README.md": "x" });
    writeFiles(root, { [`${J}/REGISTRY.md`]: registryMd(["EJ-001"]), [file(validMeta())]: journeyMd(validMeta()) });
    git(root, "add", "-A");
    expect(checkHistory(root, baseSha)).toEqual([]);
  });
});

describe("resolveBase", () => {
  const HEAD = "h".repeat(40);
  /** A fake `git` that answers from a table and throws for anything else. */
  const run = (answers: Record<string, string>) => (args: string[]) => {
    const key = args.join(" ");
    if (key in answers) return answers[key];
    throw new Error(`unexpected git ${key}`);
  };

  it("a pull request uses the event's base sha", () => {
    const r = resolveBase({ eventName: "pull_request", payload: { pull_request: { base: { sha: "b".repeat(40) } } }, headSha: HEAD, run: run({}) });
    expect(r).toEqual({ base: "b".repeat(40) });
  });

  it("a v* tag uses the previous v* tag", () => {
    const answers = { "describe --tags --abbrev=0 --match v* refs/tags/v0.3.5^": "v0.3.4", "rev-parse v0.3.4^{commit}": "p".repeat(40) };
    const r = resolveBase({ eventName: "push", ref: "refs/tags/v0.3.5", payload: {}, headSha: HEAD, run: run(answers) });
    expect(r).toEqual({ base: "p".repeat(40) });
  });

  it("a manual dispatch uses its base input, and fails without one", () => {
    const answers = { "rev-parse 1234567^{commit}": "q".repeat(40) };
    const ok = resolveBase({ eventName: "workflow_dispatch", payload: { inputs: { base: "1234567" } }, headSha: HEAD, run: run(answers) });
    expect(ok).toEqual({ base: "q".repeat(40) });
    const missing = resolveBase({ eventName: "workflow_dispatch", payload: { inputs: {} }, headSha: HEAD, run: run({}) });
    expect(missing.error).toMatch(/base/);
  });

  it("a local run uses the merge-base with master", () => {
    const r = resolveBase({ eventName: "", payload: {}, headSha: HEAD, run: run({ "merge-base HEAD master": "m".repeat(40) }) });
    expect(r).toEqual({ base: "m".repeat(40) });
  });

  it("an explicit --base wins over the event", () => {
    const r = resolveBase({ eventName: "pull_request", explicit: "abc", payload: {}, headSha: HEAD, run: run({ "rev-parse abc^{commit}": "e".repeat(40) }) });
    expect(r).toEqual({ base: "e".repeat(40) });
  });

  it("a local run on master itself compares the working tree against HEAD, not an error", () => {
    const r = resolveBase({ eventName: "", payload: {}, headSha: HEAD, run: run({ "merge-base HEAD master": HEAD }) });
    expect(r).toEqual({ base: HEAD });
  });

  it("in CI, a base equal to HEAD is an error, not a pass", () => {
    const r = resolveBase({ eventName: "pull_request", payload: { pull_request: { base: { sha: HEAD } } }, headSha: HEAD, run: run({}) });
    expect(r.error).toMatch(/HEAD/);
  });

  it("a tag with no earlier v* tag is an error", () => {
    const failing = () => {
      throw new Error("No names found");
    };
    const r = resolveBase({ eventName: "push", ref: "refs/tags/v0.1.0", payload: {}, headSha: HEAD, run: failing });
    expect(r.error).toBeTruthy();
  });

  it("any other event is an error", () => {
    const r = resolveBase({ eventName: "schedule", payload: {}, headSha: HEAD, run: run({}) });
    expect(r.error).toMatch(/schedule/);
  });
});
