// @vitest-environment node
/**
 * ADR0149E-F2M1 (fix 2, gpt-auditor round one M1): a replay run that goes through
 * heavy-lock.sh is bounded by its own run budget plus heavy-lock's admission wait, so a
 * contended run reaches heavy-lock's own refusal (exit 75) instead of being killed first;
 * the entry's launcher bound covers three such runs.
 */
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as worktree from "../../scripts/tdd/replay-worktree.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as locks from "../../scripts/tdd/receipt-locks.mjs";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });

describe("ADR0149E-F2M1 the replay run bound covers heavy-lock's wait", () => {
  it("adds heavy-lock's admission wait to a wrapped run, and the launcher covers three of them", () => {
    expect(worktree.replaySpawnTimeoutMs).toBeTypeOf("function");
    expect(worktree.replaySpawnTimeoutMs({}, true)).toBe(900_000 + 1_800_000);
    expect(worktree.replaySpawnTimeoutMs({ MDPRO_HEAVY_LOCK_WAIT_SECS: "60" }, true)).toBe(900_000 + 60_000);
    expect(worktree.replaySpawnTimeoutMs({ MDPRO_REPLAY_TIMEOUT_MS: "1500" }, true)).toBe(1500 + 1_800_000);
    expect(worktree.replaySpawnTimeoutMs({ MDPRO_HEAVY_LOCK_WAIT_SECS: "60" }, false)).toBe(900_000);
    expect(locks.launcherBoundMs("replay", {}, 900_000)).toBeGreaterThan(3 * (900_000 + 1_800_000));
    expect(locks.launcherBoundMs("replay", { MDPRO_HEAVY_LOCK_WAIT_SECS: "60", MDPRO_REPLAY_TIMEOUT_MS: "1000" }, 900_000)).toBeGreaterThan(3 * (1000 + 60_000));
    expect(locks.launcherBoundMs("replay", { MDPRO_HEAVY_LOCK_WAIT_SECS: "3600" }, 900_000)).toBeGreaterThan(3 * (900_000 + 3_600_000));
  });
});

/** A heavy-lock.sh stand-in: waits ADR0149E_LOCK_SLEEP seconds (a contended admission), then runs the job; an install links node_modules. */
const FAKE_LOCK = '#!/bin/sh\nsleep "${ADR0149E_LOCK_SLEEP:-0}"\nif [ "$1" = pnpm ] && [ "$2" = install ]; then ln -s "$ADR0149E_NODE_MODULES" node_modules; exit 0; fi\nexec "$@"\n';
let repo: ReceiptRepo;
const slowLock = () => ({ ADR0149E_LOCK_SLEEP: "9", ADR0149E_NODE_MODULES: join(repo.root, "node_modules"), MDPRO_REPLAY_TIMEOUT_MS: "8000", MDPRO_HEAVY_LOCK_WAIT_SECS: "10" });
async function replay() {
  const result = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], slowLock(), 200_000);
  const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
  return { ...result, evidence: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null };
}
function addFakeLock() {
  repo.write("scripts/heavy-lock.sh", FAKE_LOCK);
  chmodSync(join(repo.root, "scripts/heavy-lock.sh"), 0o755);
}

describe.skipIf(!pluginVersion)("ADR0149E-F2M1 a contended heavy-lock admission does not time the run out", () => {
  beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
  afterEach(async () => { await repo.close(); });

  it("a Vitest replay whose install, base and head runs each wait at heavy-lock passes", async () => {
    addFakeLock();
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  expect(v()).toBe(2);\n});\n');
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    repo.write("package.json", JSON.stringify({ type: "module", scripts: {}, description: "lockfile-changed head" }));
    await repo.commit("fix");
    const result = await replay();
    expect(result.output).not.toMatch(/timed out|pnpm install for the base lockfile failed/);
    expect(result.output).toMatch(/^replay: passed$/m);
    expect(result.status, result.output).toBe(0);
  });

  it("a Rust replay whose recorded lane command starts with heavy-lock.sh passes", async () => {
    addFakeLock();
    repo.write("src-tauri/Cargo.toml", '[package]\nname = "tauri-app"\nversion = "0.0.0"\nedition = "2021"\n');
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    1\n}\n");
    repo.write(".claude/tdd-guardian/config.json", repo.read(".claude/tdd-guardian/config.json").replace("node scripts/cargo-test-lane.mjs node scripts/fake-cargo.mjs", "scripts/heavy-lock.sh node scripts/cargo-test-lane.mjs node scripts/fake-cargo.mjs"));
    repo.write("fake-cargo/judge.json", JSON.stringify([{ target: "tauri_app_lib", name: "tests::value_is_two", file: "src/lib.rs", testMarker: "TEST_MARKER", prodMarker: "// FIXED", assertText: "assert_eq!(super::value(), 2)", message: "assertion `left == right` failed\n  left: 1\n right: 2" }]));
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    // TEST_MARKER\n    #[test]\n    fn value_is_two() {\n        assert_eq!(super::value(), 2);\n    }\n}\n");
    await repo.commit("spec");
    const recorded = await repo.entry("record", "--id", "A", "--lane", "rust", "--test", "src-tauri/src/lib.rs");
    expect(recorded.status, recorded.output).toBe(0);
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    // FIXED\n    2\n}\n\n#[cfg(test)]\nmod tests {\n    // TEST_MARKER\n    #[test]\n    fn value_is_two() {\n        assert_eq!(super::value(), 2);\n    }\n}\n");
    await repo.commit("fix");
    const result = await replay();
    expect(result.output).not.toMatch(/timed out/);
    expect(result.evidence?.replay.reasons).toEqual([]);
    expect(result.status, result.output).toBe(0);
  });
});
