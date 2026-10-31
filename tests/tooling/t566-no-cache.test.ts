// @vitest-environment node
/**
 * T566-1 (#566 AC-1): the receipt entry runs the vendored engine, so `record`, `verify`,
 * `check-pending`, `replay` and `discard` work with no tdd-guardian plugin cache, ignore a
 * poisoned cache (Claude's or Codex's) when one exists, never probe the cache directories,
 * and keep stamping evidence with the vendored version.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, homeEnv, lockPluginRoots, makeHome, rustfmt, unlockPluginRoots } from "../support/t566Engine";
import { createReceiptRepo, entryScript, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
let home: { home: string; marker: string };
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => {
  await repo.close();
  if (home) { unlockPluginRoots(home.home); rmSync(home.home, { recursive: true, force: true }); }
});

const entry = (...args: string[]) => repo.run(process.execPath, [entryScript, ...args, "--cwd", repo.root], homeEnv(home.home));
const spec = 'import { expect, it } from "vitest";\nimport { value } from "../src/calc.mjs";\nit("value", () => {\n  expect(value()).toBe(2);\n});\n';

/** Base production returns 1 on master; the feature branch adds a spec that wants 2. */
async function redBranch() {
  repo.write("src/calc.mjs", "export const value = () => 1;\n");
  await repo.commit("base production");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/calc.test.ts", spec);
  await repo.commit("spec");
}

/** record → fix → verify → check-pending → replay, asserting each step's effect. */
async function roundTrip() {
  await redBranch();
  const recorded = await entry("record", "--id", "A", "--test", "tests/calc.test.ts");
  expect(recorded.status, recorded.output).toBe(0);
  expect(recorded.stdout).toMatch(/^Recorded A: assertion-failure in tests\/calc\.test\.ts/m);
  expect(repo.store().map((receipt) => [receipt.id, receipt.lane, receipt.red.kind, receipt.verdict])).toEqual([["A", "unit-red", "assertion-failure", null]]);
  expect(repo.evidence().entries.A.plugin_version).toBe(ENGINE_VERSION);
  expect((await repo.refs()).some((line) => line.startsWith("refs/receipts/"))).toBe(true);

  repo.write("src/calc.mjs", "export const value = () => 2;\n");
  await repo.commit("fix");
  const verified = await entry("verify", "--id", "A");
  expect(verified.status, verified.output).toBe(0);
  expect(verified.stdout).toContain("A: SEPARATION-HELD");
  expect(repo.store()[0].verdict).toBe("SEPARATION-HELD");
  expect(repo.evidence().entries.A.settled_blobs).toBeTruthy();

  const pending = await entry("check-pending");
  expect(pending.status, pending.output).toBe(0);
  expect(pending.stdout).toContain("No unsettled, invalid or unevidenced branch receipts.");

  const replayed = await entry("replay", "--id", "A", "--base", "master");
  expect(replayed.status, replayed.output).toBe(0);
  const evidencePath = /^evidence: (.+)$/m.exec(replayed.output)?.[1];
  expect(evidencePath && JSON.parse(readFileSync(evidencePath, "utf8")).replay.result).toBe("passed");
  expect(repo.store()[0].verdict).toBe("SEPARATION-HELD");
  expect(repo.evidence().entries.A.plugin_version).toBe(ENGINE_VERSION);
}

describe("T566-1 the entry needs no plugin cache", () => {
  it("records, verifies, checks and replays a frontend RED with an empty HOME", async () => {
    home = makeHome(false);
    await roundTrip();
  });

  it("judges an unsettled receipt through the engine with an empty HOME", async () => {
    home = makeHome(false);
    await redBranch();
    expect((await entry("record", "--id", "A", "--test", "tests/calc.test.ts")).status).toBe(0);
    const pending = await entry("check-pending");
    expect(pending.status, pending.output).toBe(1);
    expect(pending.stderr).toContain("A (unit-red): verdict unsettled");
  });

  it("never runs a poisoned Claude or Codex cache, and stamps evidence with the vendored version", async () => {
    home = makeHome(true);
    await roundTrip();
    expect(existsSync(home.marker)).toBe(false);
  });

  it("never probes the plugin cache directories", async () => {
    home = makeHome(false);
    lockPluginRoots(home.home);
    await roundTrip();
  });

  it("discards an unsettled RED with a poisoned cache present", async () => {
    home = makeHome(true);
    await redBranch();
    expect((await entry("record", "--id", "B", "--test", "tests/calc.test.ts")).status).toBe(0);
    expect(repo.evidence().entries.B).toBeTruthy();
    const discarded = await entry("discard", "--id", "B");
    expect(discarded.status, discarded.output).toBe(0);
    expect(discarded.stdout).toContain("Discarded B (unit-red, unsettled).");
    expect(repo.store().map((receipt) => receipt.id)).not.toContain("B");
    expect(repo.evidence().entries.B).toBeUndefined();
    expect(existsSync(home.marker)).toBe(false);
  });

  it("leaves an inherited parent record and its evidence alone while settling a branch RED", async () => {
    home = makeHome(false);
    await redBranch();
    expect((await entry("record", "--id", "M", "--test", "tests/calc.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const value = () => 2;\n");
    await repo.commit("fix M");
    expect((await entry("verify", "--id", "M")).status).toBe(0);
    await repo.commit("settle M");
    await repo.git("branch", "-f", "master", "HEAD");
    const parent = JSON.stringify(repo.store().find((receipt) => receipt.id === "M"));
    const parentEvidence = JSON.stringify(repo.evidence().entries.M);
    repo.write("tests/calc.test.ts", spec.replace("it(", "// moved\nit("));
    repo.write("src/two.mjs", "export const two = () => 0;\n");
    repo.write("tests/two.test.ts", 'import { expect, it } from "vitest";\nimport { two } from "../src/two.mjs";\nit("two", () => {\n  expect(two()).toBe(2);\n});\n');
    await repo.commit("change M's spec, add A's");
    expect((await entry("record", "--id", "A", "--test", "tests/two.test.ts")).status).toBe(0);
    repo.write("src/two.mjs", "export const two = () => 2;\n");
    await repo.commit("fix A");
    const verified = await entry("verify", "--id", "A");
    expect(verified.status, verified.output).toBe(0);
    expect(verified.stdout).toContain("A: SEPARATION-HELD");
    expect(JSON.stringify(repo.store().find((receipt) => receipt.id === "M"))).toBe(parent);
    expect(JSON.stringify(repo.evidence().entries.M)).toBe(parentEvidence);
  });
});

const red = "\nrunning 1 test\ntest x_tests::f ... FAILED\n\nfailures:\n\n---- x_tests::f stdout ----\n\nthread 'x_tests::f' (3) panicked at src/x_tests.rs:3:5:\nassertion failed: false\n\nfailures:\n    x_tests::f\n\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";
const green = "\nrunning 1 test\ntest x_tests::f ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n";
const running = "     Running unittests src/lib.rs (target/debug/deps/tauri_app_lib-0123456789abcdef)\n";

describe.skipIf(!rustfmt)("T566-1 the rust lane needs no plugin cache", () => {
  it("records and verifies a rust RED with a poisoned HOME", async () => {
    home = makeHome(true);
    repo.write("src-tauri/Cargo.toml", '[package]\nname = "tauri-app"\nversion = "0.0.0"\nedition = "2021"\n');
    repo.write("src-tauri/src/x_tests.rs", "#[test]\nfn f() {\n    assert!(false);\n}\n");
    repo.cargoOutput(red, running, 101);
    await repo.commit("rust fixture");
    const recorded = await entry("record", "--id", "R", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs");
    expect(recorded.status, recorded.output).toBe(0);
    expect(repo.store().map((receipt) => [receipt.id, receipt.lane])).toEqual([["R", "rust"]]);
    expect(["assertion-failure", "opaque-failure"]).toContain(repo.store()[0].red.kind);
    expect(repo.evidence().entries.R.plugin_version).toBe(ENGINE_VERSION);
    repo.cargoOutput(green, running, 0);
    const verified = await entry("verify", "--id", "R", "--lane", "rust");
    expect(verified.status, verified.output).toBe(0);
    expect(verified.stdout).toContain("R: SEPARATION-HELD");
    expect(repo.store()[0].verdict).toBe("SEPARATION-HELD");
    repo.write("src-tauri/src/x_tests.rs", "#[test]\nfn f() {\n    assert!(false, \"again\");\n}\n");
    repo.cargoOutput(red, running, 101);
    await repo.commit("second rust red");
    expect((await entry("record", "--id", "R2", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs")).status).toBe(0);
    const discarded = await entry("discard", "--id", "R2", "--lane", "rust");
    expect(discarded.status, discarded.output).toBe(0);
    expect(discarded.stdout).toContain("Discarded R2 (rust, unsettled).");
    expect(repo.store().map((receipt) => receipt.id)).toEqual(["R"]);
    expect(existsSync(home.marker)).toBe(false);
  });
});
