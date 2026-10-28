// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SPAWN_CHILD_TIMEOUT_MS, SPAWN_TEST_TIMEOUT_MS } from '../support/spawnTestTimeout';
// @ts-expect-error -- plain ESM repository script has no declaration file
import { compare } from "../../scripts/ci/compare-report.mjs";
// @ts-expect-error -- plain ESM repository script has no declaration file
import { hasPrerequisite } from "../../scripts/ci/verify-inventory.mjs";

const root = path.resolve(__dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "adr141-inventory-"));
const profileScript = path.join(root, "scripts/ci/runner-profile.mjs");
const file = "tests/tooling/codex-role-rules.test.ts";
const id = [file, "shared Codex command policy", "forbids git push origin x"];
const inventory = { schemaVersion: 1, tests: [{ id, prerequisite: "codex-cli" }], exclusions: [] };

afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));

function report(status: "passed" | "skipped") {
  return { success: true, testResults: [{
    name: path.join(root, file), status: "passed",
    assertionResults: [{ ancestorTitles: [id[1]], title: id[2], status }],
  }] };
}

function profile(env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number; stdout: string }>(resolve => {
    execFile(process.execPath, [profileScript], { cwd: root, env, encoding: "utf8",
      timeout: SPAWN_CHILD_TIMEOUT_MS, killSignal: "SIGTERM" }, (error, stdout) => {
      resolve({ status: error ? 1 : 0, stdout });
    });
  });
}

function fakeCodex(status: number) {
  const bin = fs.mkdtempSync(path.join(temp, "bin-"));
  const executable = path.join(bin, "codex");
  fs.writeFileSync(executable, `#!/bin/sh\nexit ${status}\n`);
  fs.chmodSync(executable, 0o755);
  return bin;
}

describe("ADR141 Codex CLI inventory prerequisite", () => {
  it("requires a skip when absent and a pass when present on the same ID", () => {
    expect(compare("ci", report("skipped"), inventory, "ubuntu+rustfmt", root)).toEqual({ total: 1, passed: 0 });
    expect(() => compare("ci", report("passed"), inventory, "ubuntu+rustfmt", root)).toThrow(/Stale inventory entry/);
    expect(compare("ci", report("passed"), inventory, "ubuntu+rustfmt+codex-cli", root)).toEqual({ total: 1, passed: 1 });
    expect(() => compare("ci", report("skipped"), inventory, "ubuntu+rustfmt+codex-cli", root)).toThrow(/Unexpected skip/);
  }, SPAWN_TEST_TIMEOUT_MS);

  it("measures a working Codex CLI on Linux and macOS", async () => {
    for (const runnerOS of ["Linux", "macOS"]) {
      const base = runnerOS === "Linux" ? "ubuntu" : "macos";
      for (const [status, suffix] of [[0, "+codex-cli"], [1, ""]] as const) {
        const result = await profile({ ...process.env, RUNNER_OS: runnerOS, HOME: temp, PATH: fakeCodex(status) });
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe(base + suffix);
      }
      const absent = await profile({ ...process.env, RUNNER_OS: runnerOS, HOME: temp, PATH: temp });
      expect(absent.status).toBe(0);
      expect(absent.stdout.trim()).toBe(base);
    }
  }, SPAWN_TEST_TIMEOUT_MS);

  it("local verifier probes Codex availability before its inventory run", () => {
    const prior = process.env.PATH;
    try {
      process.env.PATH = fakeCodex(0);
      expect(hasPrerequisite("codex-cli")).toBe(true);
      process.env.PATH = fakeCodex(1);
      expect(hasPrerequisite("codex-cli")).toBe(false);
      process.env.PATH = temp;
      expect(hasPrerequisite("codex-cli")).toBe(false);
    } finally {
      process.env.PATH = prior;
    }
  }, SPAWN_TEST_TIMEOUT_MS);

  it("registers exactly the 16 runtime policy checks under stable IDs", () => {
    const actual = JSON.parse(fs.readFileSync(path.join(root, "tests/ci-inventory.json"), "utf8")) as {
      tests: Array<{ id: string[]; prerequisite: string }>;
    };
    const entries = actual.tests.filter(item => item.prerequisite === "codex-cli");
    expect(entries).toHaveLength(16);
    expect(entries.filter(item => item.id[0] === "tests/tooling/codex-role-rules-composition.test.ts")
      .map(item => item.id[1]).sort()).toEqual([
        "auditor composes with the shared policy", "delegator composes with the shared policy",
        "implementor composes with the shared policy",
      ]);
    expect(entries.filter(item => item.id[0] === file).map(item => item.id[2]).sort()).toEqual([
      "does not forbid gh pr create", "does not forbid gh pr view 1",
      "does not forbid gh workflow run release.yml", "forbids gh pr merge 1",
      "forbids gh release create v1", "forbids git push --force origin master",
      "forbids git push --force-with-lease=a:b origin a", "forbids git push origin +HEAD:x",
      "forbids git push origin --force master", "forbids git push origin --mirror",
      "forbids git push origin x", "forbids git reset --hard", "forbids rm -rf src",
    ].sort());
  }, SPAWN_TEST_TIMEOUT_MS);
});
