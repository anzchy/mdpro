// @vitest-environment node
/**
 * T566-F2-1 (#566 fix 2, AC-F2-1): the receipt suites take the engine and its version from the vendored copy,
 * never from a tdd-guardian plugin cache, so a newer and poisoned, a missing or an unreadable cache neither fails nor
 * skips them. Local-only, like every `plugin` entry: `t566-fix2-ci-shape.test.ts` proves the GitHub-runner side.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, homeEnv, lockPluginRoots, makeHome, repoRoot, unlockPluginRoots } from "../support/t566Engine";
import { childVitest, statusCounts as counts } from "../support/t566Child";
import { pluginVersion } from "./adr0149eRepo";
import { createOwnerChildRunner } from "./d302Child";

vi.setConfig({ testTimeout: 600_000 });
/** Inline, not `receiptSuites`: the RED must not skip on a name the fix has not exported yet. */
const local = !process.env.RUNNER_OS;
const RECORD_EVIDENCE = "tests/tooling/adr0149e-record-evidence.test.ts";
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) { unlockPluginRoots(dir); rmSync(dir, { recursive: true, force: true }); }
});

describe.skipIf(!local)("T566-F2-1 receipt suites ignore the plugin cache", () => {
  it("pins the evidence version to the vendored engine, not the newest cache", () => {
    expect(ENGINE_VERSION).toBe("0.10.2");
    expect(pluginVersion).toBe(ENGINE_VERSION);
    expect(readFileSync(join(repoRoot, RECORD_EVIDENCE), "utf8")).toMatch(/toMatchObject\(\{[^}]*plugin_version: pluginVersion[^}]*\}\)/);
  });

  for (const [name, setup] of [
    ["a poisoned newer cache (9.9.9)", () => makeHome(true)],
    ["no cache at all", () => makeHome(false)],
    ["unreadable plugin roots", () => { const made = makeHome(false); lockPluginRoots(made.home); return made; }],
  ] as const) {
    it(`runs adr0149e-record-evidence with ${name}: every test passes, none skips`, async ({ signal }) => {
      const { home, marker } = setup();
      scratch.push(home);
      const run = await childVitest(signal, [RECORD_EVIDENCE], homeEnv(home));
      scratch.push(run.dir);
      expect(run.failed).toEqual([]);
      expect(counts(run.statuses), run.output).toEqual({ passed: 6 });
      expect(run.status, run.output).toBe(0);
      expect(existsSync(marker)).toBe(false);
    });
  }

  it("loads and spawns only the vendored engine in red-receipt and unit-red-lane, under a poisoned cache", async ({ signal }) => {
    const { home, marker } = makeHome(true);
    scratch.push(home);
    const run = await childVitest(signal, ["tests/tooling/red-receipt.test.ts", "tests/tooling/unit-red-lane.test.ts"], homeEnv(home));
    scratch.push(run.dir);
    expect(run.failed).toEqual([]);
    expect(Object.keys(counts(run.statuses)), run.output).toEqual(["passed"]);
    expect(run.statuses.size).toBeGreaterThanOrEqual(30);
    expect(run.status, run.output).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it("bare_record spawns exactly the receipt.js it is handed", async ({ signal }) => {
    const stubDir = mkdtempSync(join(tmpdir(), "mdpro-t566f2-stub-"));
    scratch.push(stubDir);
    const marker = join(stubDir, "stub-ran");
    writeFileSync(join(stubDir, "receipt.js"), `require("fs").writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" ")); process.exit(0);\n`);
    writeFileSync(join(stubDir, "package.json"), '{"type":"commonjs"}\n');
    const owner = createOwnerChildRunner(signal);
    try {
      const script = join(repoRoot, "tests/tooling/fixtures/unit-red/scenarios.mjs");
      const result = await owner.run(process.execPath, [script, "bare_record", repoRoot, join(stubDir, "receipt.js")], { cwd: repoRoot, timeout: 60_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).status).toBe(0);
      expect(readFileSync(marker, "utf8")).toMatch(/^record --id A --files tests\//);
    } finally { await owner.close(); }
  });
});
