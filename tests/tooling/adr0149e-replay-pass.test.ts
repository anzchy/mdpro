// @vitest-environment node
/**
 * ADR0149E-4a (AC-4, ADR-0149 d2): `replay --id` runs the head's tests in a detached
 * worktree whose non-test paths are restored to the PR base; a recorded id passes the
 * replay when it fails at base with an assertion at the RED location (the RED line
 * mapped onto the file as it sits in that run, or the same message when the line itself
 * changed) and passes at head. The receipt's verdict never changes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

type Evidence = { replay: { result: string; reasons: string[]; ids: Record<string, { base: { status: string; kind: string | null }; head: { status: string } }> } };
async function replay(...extra: string[]) {
  const result = await repo.entry("replay", "--id", "A", ...extra);
  const path = /^evidence: (.+)$/m.exec(result.output)?.[1];
  return { ...result, evidence: path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Evidence) : null };
}
const vid = (file: string, title: string) => JSON.stringify([file, title]);

/** Base production returns `value`; a branch commit before the RED may change it to `redValue`. */
async function calcBranch(spec: string, value: string, redValue = value) {
  repo.write("src/calc.mjs", `export const value = () => ${value};\n`);
  await repo.commit("base production");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("src/calc.mjs", `export const value = () => ${redValue};\n`);
  repo.write("tests/calc.test.ts", spec);
  await repo.commit("spec");
  const recorded = await repo.entry("record", "--id", "A", "--test", "tests/calc.test.ts");
  expect(recorded.status, recorded.output).toBe(0);
}

describe.skipIf(!pluginVersion)("ADR0149E-4a replay passes", () => {
  it("passes when the base fails at the RED line and the head passes, and leaves the verdict, index and worktrees alone", async () => {
    await calcBranch('import { expect, it } from "vitest";\nimport { value } from "../src/calc.mjs";\nit("value", () => {\n  expect(value()).toBe(2);\n});\n', "1");
    repo.write("src/calc.mjs", "export const value = () => 2;\n");
    await repo.commit("fix");
    repo.write("tests/calc.test.ts", 'import { it } from "vitest";\nit.skip("value", () => {});\n');
    const before = await repo.snapshot();
    const worktrees = (await repo.git("worktree", "list", "--porcelain")).stdout;
    const result = await replay();
    expect(result.status, result.output).toBe(0);
    expect(result.evidence?.replay.result).toBe("passed");
    expect(result.evidence?.replay.ids[vid("tests/calc.test.ts", "value")]).toMatchObject({ base: { status: "failed", kind: "assertion" }, head: { status: "passed" } });
    expect(repo.store()[0].verdict).toBeNull();
    expect((await repo.snapshot()).index).toBe(before.index);
    expect((await repo.git("worktree", "list", "--porcelain")).stdout).toBe(worktrees);
  });

  it("follows the RED line when the head moves it, and matches the same line with a different base message", async () => {
    await calcBranch('import { expect, it } from "vitest";\nimport { value } from "../src/calc.mjs";\nit("value", () => {\n  expect(value()).toBe(2);\n});\n', "3", "1");
    repo.write("src/calc.mjs", "export const value = () => 2;\n");
    repo.write("tests/calc.test.ts", 'import { expect, it } from "vitest";\nimport { value } from "../src/calc.mjs";\n// a note\n// another\nit("value", () => {\n  expect(value()).toBe(2);\n});\n');
    await repo.commit("fix and move");
    const result = await replay("--base", "master");
    expect(result.evidence?.replay.reasons).toEqual([]);
    expect(result.evidence?.replay.result).toBe("passed");
  });

  it("restores changed, added, deleted and renamed production paths to base and keeps seams at base", async () => {
    repo.write("src/old.mjs", "export {};\n");
    repo.write("src/r1.mjs", "export {};\n");
    repo.write("src-tauri/src/seam.rs", "pub fn real() {}\n#[cfg(test)]\npub fn seam() {}\n");
    await repo.commit("base production");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/tree.test.ts", [
      'import { existsSync, readFileSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'it("added", () => { expect(existsSync("src/added.mjs")).toBe(true); });',
      'it("deleted", () => { expect(existsSync("src/old.mjs")).toBe(false); });',
      'it("renamed to", () => { expect(existsSync("src/r2.mjs")).toBe(true); });',
      'it("renamed from", () => { expect(existsSync("src/r1.mjs")).toBe(false); });',
      'it("seam", () => { expect(readFileSync("src-tauri/src/seam.rs", "utf8")).toContain("HEAD_SEAM"); });',
      "",
    ].join("\n"));
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/tree.test.ts")).status).toBe(0);
    repo.write("src/added.mjs", "export {};\n");
    await repo.git("rm", "-q", "src/old.mjs");
    await repo.git("mv", "src/r1.mjs", "src/r2.mjs");
    repo.write("src-tauri/src/seam.rs", "pub fn real() {}\n#[cfg(test)]\npub fn seam() {\n    // HEAD_SEAM\n}\n");
    await repo.commit("production change");
    const result = await replay();
    expect(result.evidence?.replay.reasons).toEqual([]);
    expect(result.evidence?.replay.result).toBe("passed");
  });

  it("replays the committed head, not the caller's dirty working tree, and finds the pin from another worktree", async () => {
    await calcBranch('import { expect, it } from "vitest";\nimport { value } from "../src/calc.mjs";\nit("value", () => {\n  expect(value()).toBe(2);\n});\n', "1");
    repo.write("src/calc.mjs", "export const value = () => 2;\n");
    await repo.commit("fix");
    repo.write("src/calc.mjs", "export const value = () => 7;\n");
    expect((await replay()).evidence?.replay.result).toBe("passed");
    const other = join(repo.root, "..", `${repo.root.split("/").at(-1)}-b`);
    await repo.git("worktree", "add", "-q", "--detach", other, "HEAD");
    const second = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", other]);
    await repo.git("worktree", "remove", "--force", other);
    expect(second.output).toMatch(/^replay: passed/m);
  });

  it("splices the head's Rust test module into the base's production file", async () => {
    repo.write("src-tauri/Cargo.toml", '[package]\nname = "tauri-app"\nversion = "0.0.0"\nedition = "2021"\n');
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    1\n}\n");
    repo.write(".claude/tdd-guardian/config.json", repo.read(".claude/tdd-guardian/config.json").replace("node scripts/cargo-test-lane.mjs node scripts/fake-cargo.mjs", "node -e process.exit(64)"));
    repo.write("scripts/cargo-test-lane.mjs", 'import { spawnSync } from "node:child_process";\nconst [cmd, ...args] = process.argv.slice(2);\nprocess.exitCode = spawnSync(cmd, args, { stdio: "inherit" }).status ?? 1;\n');
    repo.write("fake-cargo/judge.json", JSON.stringify([{ target: "tauri_app_lib", name: "tests::value_is_two", file: "src/lib.rs", testMarker: "TEST_MARKER", prodMarker: "// FIXED", assertText: "assert_eq!(super::value(), 2)", message: "assertion `left == right` failed\n  left: 1\n right: 2" }]));
    await repo.commit("base: rust lane broken, plain wrapper");
    await repo.git("branch", "-f", "master", "HEAD");
    await repo.git("checkout", "-q", "HEAD~1", "--", ".claude/tdd-guardian/config.json", "scripts/cargo-test-lane.mjs");
    repo.write("fake-cargo/judge.json", JSON.stringify([{ target: "tauri_app_lib", name: "tests::value_is_two", file: "src/lib.rs", testMarker: "TEST_MARKER", prodMarker: "// FIXED", assertText: "assert_eq!(super::value(), 2)", message: "assertion `left == right` failed\n  left: 1\n right: 2" }]));
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    // TEST_MARKER\n    #[test]\n    fn value_is_two() {\n        assert_eq!(super::value(), 2);\n    }\n}\n");
    await repo.commit("lane restored, spec");
    const recorded = await repo.entry("record", "--id", "A", "--lane", "rust", "--test", "src-tauri/src/lib.rs");
    expect(recorded.status, recorded.output).toBe(0);
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    // FIXED\n    // more\n    // lines\n    2\n}\n\n#[cfg(test)]\nmod tests {\n    // TEST_MARKER\n    #[test]\n    fn value_is_two() {\n        assert_eq!(super::value(), 2);\n    }\n}\n");
    await repo.commit("fix");
    const result = await replay();
    expect(result.evidence?.replay.reasons).toEqual([]);
    expect(result.evidence?.replay.ids["tauri_app_lib::tests::value_is_two"]).toMatchObject({ base: { status: "failed", kind: "assertion" }, head: { status: "passed" } });
  });
});
