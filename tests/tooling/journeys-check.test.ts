// @vitest-environment node
/**
 * Purpose: E2E-WI-1 end to end: `node scripts/journeys/check.mjs`, the command
 * behind `pnpm journeys:check`, runs every rule and exits non-zero on any
 * finding. The script reads the catalogue relative to its own location, so
 * these cases copy `scripts/journeys/` into a temp git repo next to a fixture
 * catalogue and run the copy (the pattern of
 * `feature-ledger-windows-diff-gate.test.ts`). The last case runs the real
 * script on the real tree, where the sample journey EJ-001 must pass
 * (acceptance 6).
 *
 * @module tests/tooling/journeys-check.test
 * @coordinates-with scripts/journeys/check.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { countBlock } from "../../scripts/journeys/catalogue.mjs";
import { git, journeyMd, registryMd, repoWithBase, validMeta, writeFiles } from "../support/journeysFixture";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const J = "tests/journeys";

function repo() {
  const meta = validMeta();
  const { root, baseSha } = repoWithBase({
    [`${J}/REGISTRY.md`]: registryMd(["EJ-001"]),
    [`${J}/EJ-001-x.md`]: journeyMd(meta),
    [`${J}/README.md`]: `# Journeys\n\n${countBlock([meta])}\n`,
    [`${J}/projections/EJ-001.json`]: JSON.stringify({ projectionVersion: 1, events: {} }),
  });
  fs.cpSync(path.join(REPO, "scripts/journeys"), path.join(root, "scripts/journeys"), { recursive: true });
  return { root, baseSha };
}

const run = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [path.join(root, "scripts/journeys/check.mjs"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_NAME: "" } });

describe("check.mjs", () => {
  it("exits 0 on a clean catalogue", () => {
    const { root, baseSha } = repo();
    const r = run(root, "--base", baseSha);
    expect(r.stderr + r.stdout).not.toMatch(/journey-/);
    expect(r.status).toBe(0);
  });

  it("exits 1 and names the rule on a per-file finding", () => {
    const { root, baseSha } = repo();
    writeFiles(root, { [`${J}/EJ-001-x.md`]: journeyMd(validMeta({ tier: [] })) });
    const r = run(root, "--base", baseSha);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("journey-meta-field");
  });

  it("exits 1 on a history finding", () => {
    const { root, baseSha } = repo();
    writeFiles(root, { [`${J}/REGISTRY.md`]: registryMd([]) });
    const r = run(root, "--base", baseSha);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("journey-registry-shrank");
  });

  it("exits 1 when the base cannot be resolved", () => {
    const { root } = repo();
    const r = run(root, "--base", "no-such-ref");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/base/);
  });

  it("checks every run manifest under docs/test/journey-runs/", () => {
    const { root, baseSha } = repo();
    writeFiles(root, { "docs/test/journey-runs/2026-10-15-smoke-macos-0000000-1.json": '{"runId": 1}' });
    const r = run(root, "--base", baseSha);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("manifest-schema");
  });

  it("--write-count rewrites a stale README count, then the check passes", () => {
    const { root, baseSha } = repo();
    const two = validMeta({ id: "EJ-002", projection: `${J}/projections/EJ-002.json` });
    writeFiles(root, {
      [`${J}/REGISTRY.md`]: registryMd(["EJ-001", "EJ-002"]),
      [`${J}/EJ-002-y.md`]: journeyMd(two),
      [`${J}/projections/EJ-002.json`]: JSON.stringify({ projectionVersion: 1, events: {} }),
    });
    expect(run(root, "--base", baseSha).stdout).toContain("journey-count");
    expect(run(root, "--write-count").status).toBe(0);
    git(root, "add", "-A");
    expect(run(root, "--base", baseSha).status).toBe(0);
  });
});

describe("the real catalogue", () => {
  it("passes, with the sample journey EJ-001 in it", () => {
    const r = spawnSync(process.execPath, ["scripts/journeys/check.mjs", "--base", "HEAD"], { cwd: REPO, encoding: "utf8" });
    expect(r.stdout + r.stderr).toContain("EJ-001");
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
