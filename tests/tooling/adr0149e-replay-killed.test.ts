// @vitest-environment node
/**
 * ADR0149E-4f (AC-4, review findings M3 and M8): a replay run that is killed or times out
 * fails closed with that cause (it is not read as the ids disappearing), and a replay that
 * fails or refuses part-way still removes its worktree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const replayWorktrees = async () => (await repo.git("worktree", "list", "--porcelain")).stdout.split("\n").filter((line) => line.includes("-replay-"));

describe.skipIf(!pluginVersion)("ADR0149E-4f killed runs and worktree cleanup", () => {
  it("names a timed-out base run as the cause and removes the worktree", async () => {
    repo.write("src-tauri/Cargo.toml", '[package]\nname = "tauri-app"\nversion = "0.0.0"\nedition = "2021"\n');
    repo.write("fake-cargo/judge.json", JSON.stringify([{ target: "tauri_app_lib", name: "tests::v", file: "src/lib.rs", testMarker: "TEST_MARKER", prodMarker: "// FIXED", assertText: "assert!(false)", message: "assertion failed: false" }]));
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    1\n}\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    // TEST_MARKER\n    #[test]\n    fn v() {\n        assert!(false);\n    }\n}\n");
    await repo.commit("spec");
    const recorded = await repo.entry("record", "--id", "A", "--lane", "rust", "--test", "src-tauri/src/lib.rs");
    expect(recorded.status, recorded.output).toBe(0);
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    // FIXED\n    2\n}\n\n#[cfg(test)]\nmod tests {\n    // TEST_MARKER\n    #[test]\n    fn v() {\n        assert!(false);\n    }\n}\n");
    await repo.commit("fix");
    const { entryScript } = await import("./adr0149eRepo");
    const result = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], { FAKE_CARGO_SLEEP_MS: "3000", MDPRO_REPLAY_TIMEOUT_MS: "800" });
    const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
    const evidence = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    expect(evidence?.replay.result).toBe("failed");
    expect(evidence?.replay.reasons.join("\n")).toMatch(/base run: .*(timed out|killed)/);
    expect(await replayWorktrees()).toEqual([]);
  });

  it("removes the worktree when the restore refuses part-way", async () => {
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    repo.write("src-tauri/src/odd.rs", "#[cfg(any(test, feature = \"x\"))]\nmod helpers {}\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  expect(v()).toBe(2);\n});\n');
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    repo.write("src-tauri/src/odd.rs", "#[cfg(any(test, feature = \"x\"))]\nmod helpers {\n    pub fn h() {}\n}\n");
    await repo.commit("fix");
    const result = await repo.entry("replay", "--id", "A");
    expect(result.status).toBe(64);
    expect(result.output).toMatch(/Cannot splice src-tauri\/src\/odd\.rs/);
    expect(await replayWorktrees()).toEqual([]);
  });
});
