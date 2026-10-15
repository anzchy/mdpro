// @vitest-environment node
/**
 * Purpose: E2E-WI-1b, regressions for audit b149's three High findings on the
 * journey gate (PR #465):
 * - H1: a manifest that lists a case id twice must not aggregate, so a C1 FAIL
 *   followed by a C1 PASS cannot become PASS (`manifest.mjs`).
 * - H2: the log projection keeps a line's severity, so an expected
 *   `app.ready success` does not match an `app.ready` logged at warn or error;
 *   a warn or error line is accepted only when the journey expects that level
 *   (`projection.mjs`, plan §4.4).
 * - H3: an archived run is judged against the journey revision it records,
 *   not against today's metadata, so adding a required case later does not
 *   turn an old PASS run INCOMPLETE and redden an unrelated PR
 *   (`manifest.mjs`, `check.mjs`).
 *
 * @module tests/tooling/journeys-b149.test
 * @coordinates-with scripts/journeys/manifest.mjs, scripts/journeys/projection.mjs,
 *   scripts/journeys/check.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { countBlock } from "../../scripts/journeys/catalogue.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { aggregateJourney, checkManifest } from "../../scripts/journeys/manifest.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { compareProjection } from "../../scripts/journeys/projection.mjs";
import { git, journeyMd, registryMd, repoWithBase, validMeta, writeFiles, type Meta } from "../support/journeysFixture";

interface Finding {
  rule: string;
  message: string;
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const J = "tests/journeys";
const SHA = "839bb4d8f5061f04bfe6a8403dae7152abc0f226";
const META = validMeta({ platforms: { macos: { status: "required" }, windows: { status: "n/a", reason: "r" } } });

function manifest(cases: Meta[], revision = "b".repeat(40)): Meta {
  return {
    runId: "2026-10-15-smoke-macos-839bb4d-1",
    build: { sha: SHA, binarySha256: "a".repeat(64), profile: "release", platform: "macos", os: "macOS 15.6" },
    tier: "smoke",
    journeys: [{ id: "EJ-001", revision, projectionVersion: 1, fixtures: {}, cases, verdict: "PASS" }],
    verdict: "PASS",
  };
}
const rules = (findings: Finding[]) => findings.map((f) => f.rule);

describe("H1: a case id listed twice in a manifest", () => {
  const dup = [
    { id: "C1", verdict: "FAIL", evidence: ["mdpro.log:10"] },
    { id: "C1", verdict: "PASS", evidence: ["mdpro.log:20"] },
  ];

  it("is a finding of its own", () => {
    expect(rules(checkManifest(manifest(dup), new Map([["EJ-001", META]])))).toContain("manifest-case-dup");
  });

  it("never lets a stated PASS stand for that journey or its run", () => {
    const r = rules(checkManifest(manifest(dup), new Map([["EJ-001", META]])));
    expect(r).toContain("manifest-verdict");
  });

  it("is refused by the aggregation itself rather than resolved to the last verdict", () => {
    expect(() => aggregateJourney(META, "macos", dup)).toThrow(/C1/);
  });
});

const line = (event: string, level: string, status = "success") => ({ ts: "t", level, event, status, context: {} });
const PROJECTION = { projectionVersion: 1, events: { "app.ready": { fields: [] } } };
const READY = [{ event: "app.ready", status: "success", fields: {} }];

describe("H2: the projection keeps a line's severity", () => {
  it.each(["warn", "error"])("an app.ready logged at %s does not satisfy an expected app.ready success", (level) => {
    const r = rules(compareProjection([line("app.ready", level)], PROJECTION, READY));
    expect(r).toContain("projection-failure-line");
    expect(r).toContain("projection-missing");
  });

  it("a warn line is accepted when the journey expects that level explicitly", () => {
    const exp = [{ event: "app.ready", status: "success", level: "warn", fields: {} }];
    expect(compareProjection([line("app.ready", "warn")], PROJECTION, exp)).toEqual([]);
  });

  it("an expected warn is not met by an error line", () => {
    const exp = [{ event: "app.ready", status: "success", level: "warn", fields: {} }];
    expect(rules(compareProjection([line("app.ready", "error")], PROJECTION, exp))).toContain("projection-missing");
  });

  it("info and debug lines still match an expectation that names no level", () => {
    expect(compareProjection([line("app.ready", "info")], PROJECTION, READY)).toEqual([]);
    expect(compareProjection([line("app.ready", "debug")], PROJECTION, READY)).toEqual([]);
  });
});

describe("H3: a run is judged against the journey revision it records", () => {
  const oneCase = [{ id: "C1", verdict: "PASS", evidence: ["mdpro.log:1"] }];
  const withC2 = validMeta({ ...META, cases: [...(META.cases as Meta[]), { id: "C2", mode: "S", intended: "b" }] });

  it("a resolver gets the recorded revision, and its metadata decides the aggregation", () => {
    const seen: string[] = [];
    const metaAt = (id: string, revision: string) => {
      seen.push(`${id}@${revision}`);
      return { meta: revision === "1".repeat(40) ? META : withC2 };
    };
    expect(checkManifest(manifest(oneCase, "1".repeat(40)), metaAt)).toEqual([]);
    expect(seen).toEqual([`EJ-001@${"1".repeat(40)}`]);
    expect(rules(checkManifest(manifest(oneCase, "2".repeat(40)), metaAt))).toContain("manifest-verdict");
  });

  it("a revision the resolver cannot find is a finding", () => {
    const metaAt = () => ({ error: "no such blob" });
    expect(rules(checkManifest(manifest(oneCase), metaAt))).toContain("manifest-revision");
  });

  function repo() {
    const { root, baseSha } = repoWithBase({
      [`${J}/REGISTRY.md`]: registryMd(["EJ-001"]),
      [`${J}/EJ-001-x.md`]: journeyMd(META),
      [`${J}/README.md`]: `# Journeys\n\n${countBlock([META])}\n`,
      [`${J}/projections/EJ-001.json`]: JSON.stringify({ projectionVersion: 1, events: {} }),
    });
    fs.cpSync(path.join(REPO, "scripts/journeys"), path.join(root, "scripts/journeys"), { recursive: true });
    return { root, baseSha, revision: git(root, "rev-parse", `HEAD:${J}/EJ-001-x.md`) };
  }
  const run = (root: string, base: string) =>
    spawnSync(process.execPath, [path.join(root, "scripts/journeys/check.mjs"), "--base", base], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GITHUB_EVENT_NAME: "" },
    });
  const RUN_FILE = "docs/test/journey-runs/2026-10-15-smoke-macos-839bb4d-1.json";

  it("an archived PASS stays valid after the journey gains a required case", () => {
    const { root, baseSha, revision } = repo();
    writeFiles(root, { [RUN_FILE]: JSON.stringify(manifest(oneCase, revision)) });
    expect(run(root, baseSha).status).toBe(0);
    writeFiles(root, { [`${J}/EJ-001-x.md`]: journeyMd(withC2) });
    const r = run(root, baseSha);
    expect(r.stdout).not.toContain("manifest-verdict");
    expect(r.status, r.stdout).toBe(0);
  });

  it("a manifest naming a revision that is not in the repository fails the gate", () => {
    const { root, baseSha } = repo();
    writeFiles(root, { [RUN_FILE]: JSON.stringify(manifest(oneCase, "c".repeat(40))) });
    const r = run(root, baseSha);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("manifest-revision");
  });

  it("a revision whose file is another journey is a finding", () => {
    const { root, baseSha } = repo();
    const other = validMeta({ ...META, id: "EJ-002" });
    writeFiles(root, { "elsewhere.md": journeyMd(other) });
    git(root, "add", "elsewhere.md");
    const blob = git(root, "rev-parse", ":elsewhere.md");
    fs.rmSync(path.join(root, "elsewhere.md"));
    git(root, "rm", "-q", "--cached", "elsewhere.md");
    writeFiles(root, { [RUN_FILE]: JSON.stringify(manifest(oneCase, blob)) });
    const r = run(root, baseSha);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("manifest-revision");
  });
});
