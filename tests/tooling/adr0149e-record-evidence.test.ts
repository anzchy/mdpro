// @vitest-environment node
/**
 * ADR0149E-1b (AC-1, ADR-0145 d1 and d6): `record` writes the sidecar entry, with the
 * failing ids, the plugin version, the lane command and a whitelisted environment, only
 * after the plugin's own record succeeded, under the repo-wide evidence lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 180_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const PLUGIN_KEYS = ["dirty_source", "findings", "head_sha", "id", "lane", "recorded_at", "red", "test_files", "verdict", "verified_at"];
const ENV_KEYS = ["CARGO_TARGET_DIR", "CI", "LANG", "NODE_ENV", "RUSTFLAGS", "RUST_BACKTRACE", "TZ", "VITEST_MAX_WORKERS", "node", "platform"];
const spec = [
  'import { describe, expect, it } from "vitest";',
  'describe("suite", () => {',
  '  it("fails", () => {',
  '    expect(1 + 1).toBe(3);',
  "  });",
  '  it("throws", () => { throw new TypeError("boom"); });',
  '  it("passes", () => { expect(1).toBe(1); });',
  "});",
].join("\n");

describe.skipIf(!pluginVersion)("ADR0149E-1b record evidence", () => {
  it("stores failing ids, kinds, locations, messages and the run's identity beside the plugin receipt", async () => {
    repo.write("tests/a.test.ts", spec);
    const recorded = await repo.run(process.execPath, [entryScript, "record", "--id", "A", "--test", "tests/a.test.ts", "--cwd", repo.root], { SECRET_X: "1", TZ: "UTC" });
    expect(recorded.status, recorded.output).toBe(0);
    const receipt = repo.store()[0];
    expect(Object.keys(receipt).sort()).toEqual(PLUGIN_KEYS);
    const entry = repo.evidence().entries.A;
    expect(entry).toMatchObject({ id: "A", lane: "unit-red", recorded_at: receipt.recorded_at, plugin_version: pluginVersion, lane_command: "node scripts/tdd/unit-red-lane.mjs" });
    expect(Object.keys(entry.env).every((key: string) => ENV_KEYS.includes(key))).toBe(true);
    expect(entry.env.SECRET_X).toBeUndefined();
    expect(entry.env.TZ).toBe("UTC");
    expect(entry.env.node).toBe(process.version);
    expect(entry.failures).toEqual([
      { id: JSON.stringify(["tests/a.test.ts", "suite", "fails"]), kind: "assertion", location: { file: "tests/a.test.ts", line: 4 }, message: expect.stringMatching(/^AssertionError: expected 2 to be 3/) },
      { id: JSON.stringify(["tests/a.test.ts", "suite", "throws"]), kind: "panic", location: { file: "tests/a.test.ts", line: 6 }, message: "TypeError: boom" },
    ]);
  });

  it("writes no sidecar entry and no ref when the plugin refuses the record", async () => {
    repo.write("tests/a.test.ts", 'import { expect, it } from "vitest"; it("green", () => { expect(1).toBe(1); });');
    expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).not.toBe(0);
    expect(repo.evidence()?.entries?.A).toBeUndefined();
    expect(await repo.refs()).toEqual([]);
  });

  it("refuses a malformed sidecar before running the lane and leaves its bytes alone", async () => {
    repo.write("tests/a.test.ts", spec);
    for (const bad of ["{not json", JSON.stringify({ schemaVersion: 9, entries: {} })]) {
      repo.write(".claude/tdd-guardian/evidence.json", bad);
      const result = await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts");
      expect(result.status, result.output).toBe(64);
      expect(repo.read(".claude/tdd-guardian/evidence.json")).toBe(bad);
      expect(repo.store()).toEqual([]);
    }
  });

  it("takes the repo-wide evidence lock before the lane, and fails closed with nothing written while another owner holds it", async () => {
    repo.write("tests/a.test.ts", spec);
    const sidecar = JSON.stringify({ schemaVersion: 1, entries: {} });
    repo.write(".claude/tdd-guardian/evidence.json", sidecar);
    const release = repo.holdEvidenceLock();
    const blocked = await repo.run(process.execPath, [entryScript, "record", "--id", "A", "--test", "tests/a.test.ts", "--cwd", repo.root], { MDPRO_EVIDENCE_LOCK_WAIT_MS: "1500" });
    expect(blocked.status).not.toBe(0);
    expect(blocked.output).toMatch(/evidence lock/i);
    expect(repo.read(".claude/tdd-guardian/evidence.json")).toBe(sidecar);
    release();
    expect(repo.store()).toEqual([]);
    expect(await repo.refs()).toEqual([]);
  });

  it("records the rust lane's command and its libtest failures, and the lane never sees the new entry", async () => {
    repo.write("src-tauri/src/x_tests.rs", "#[test]\nfn eq_fails() {\n    assert_eq!(1, 2);\n}\n");
    repo.write(".claude/tdd-guardian/evidence.json", JSON.stringify({ schemaVersion: 1, entries: {} }));
    repo.cargoOutput(
      "\nrunning 1 test\ntest x_tests::eq_fails ... FAILED\n\nfailures:\n\n---- x_tests::eq_fails stdout ----\n\nthread 'x_tests::eq_fails' (3) panicked at src/x_tests.rs:3:5:\nassertion `left == right` failed\n  left: 1\n right: 2\n\nfailures:\n    x_tests::eq_fails\n\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n",
      "     Running unittests src/lib.rs (target/debug/deps/tauri_app_lib-0123456789abcdef)\n",
      101,
    );
    await repo.commit("rust fixture");
    const recorded = await repo.entry("record", "--id", "R", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs");
    expect(recorded.status, recorded.output).toBe(0);
    const entry = repo.evidence().entries.R;
    expect(entry.lane).toBe("rust");
    expect(entry.lane_command).toBe("node scripts/cargo-test-lane.mjs node scripts/fake-cargo.mjs");
    expect(entry.failures).toEqual([{ id: "tauri_app_lib::x_tests::eq_fails", kind: "assertion", location: { file: "src-tauri/src/x_tests.rs", line: 3 }, message: "assertion `left == right` failed\n  left: 1\n right: 2" }]);
    expect(JSON.parse(repo.read("fake-cargo/seen.json")).entries.R).toBeUndefined();
  });

  it("fails closed when the lane leaves no readable evidence, and check-pending flags the receipt", async () => {
    repo.write("src-tauri/src/x_tests.rs", "#[test]\nfn f() {}\n");
    repo.cargoOutput("garbage with no libtest block\n", "", 1);
    await repo.commit("rust fixture");
    const recorded = await repo.entry("record", "--id", "R", "--lane", "rust", "--test", "src-tauri/src/x_tests.rs");
    expect(recorded.status).not.toBe(0);
    expect(repo.evidence()?.entries?.R).toBeUndefined();
    expect(await repo.refs()).toEqual([]);
    expect(repo.store().map((receipt) => receipt.id)).toEqual(["R"]);
    const pending = await repo.entry("check-pending");
    expect(pending.status).toBe(1);
    expect(pending.output).toMatch(/R.*no evidence|no evidence.*R/);
  });
});
