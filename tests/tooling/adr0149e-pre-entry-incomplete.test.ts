// @vitest-environment node
/**
 * ADR0149E-F1H2 (fix 1, opus-auditor round one H2): a pre-entry replay whose base run did
 * not complete (timed out, refused by heavy-lock, did not compile) records that in
 * `base_run`, says so, and never reports it as "0 case(s) pass at base"; its digest differs
 * from the digest of a run that completed.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo, scratch: string;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); scratch = mkdtempSync(join(tmpdir(), "mdpro-f1h2-")); });
afterEach(async () => { await repo.close(); rmSync(scratch, { recursive: true, force: true }); });

async function replay(env: Record<string, string> = {}) {
  const result = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], env);
  const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
  return { ...result, evidence: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null };
}
const forgetEntries = () => repo.write(".claude/tdd-guardian/evidence.json", JSON.stringify({ schemaVersion: 1, entries: {} }));

function expectIncomplete(result: Awaited<ReturnType<typeof replay>>, cause: RegExp) {
  expect(result.status).not.toBe(0);
  expect(result.output).not.toMatch(/case\(s\) pass at base/);
  expect(result.output).toMatch(/replay: pre-entry receipt; base run did not complete \(/);
  expect(result.evidence).toMatchObject({ mode: "pre-entry", user_ruling_required: true, base_run: { completed: false } });
  expect(result.evidence.passing_at_base).toBeNull();
  expect(`${result.evidence.base_run.error ?? ""} ${result.evidence.base_run.compileError ? "compile error" : ""}`).toMatch(cause);
  expect(result.evidence.digest).toMatch(/^[0-9a-f]{64}$/);
}

/** A Vitest receipt whose one case fails at base; the case blocks for 20 s while `flag` exists. */
async function vitestReceipt(flag: string) {
  repo.write("src/calc.mjs", "export const v = () => 1;\n");
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/new.test.ts", `import { existsSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  if (existsSync(${JSON.stringify(flag)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);\n  expect(v()).toBe(2);\n});\n`);
  await repo.commit("spec");
  const recorded = await repo.entry("record", "--id", "A", "--test", "tests/new.test.ts");
  expect(recorded.status, recorded.output).toBe(0);
  repo.write("src/calc.mjs", "export const v = () => 2;\n");
  forgetEntries();
  await repo.commit("fix");
}

describe.skipIf(!pluginVersion)("ADR0149E-F1H2 a pre-entry base run that did not complete", () => {
  it("a timed-out base run is named, lists no cases, and digests apart from a completed run", async () => {
    const flag = join(scratch, "block");
    await vitestReceipt(flag);
    writeFileSync(flag, "block");
    const stopped = await replay({ MDPRO_REPLAY_TIMEOUT_MS: "1500" });
    expectIncomplete(stopped, /timed out|killed/);
    unlinkSync(flag);
    const completed = await replay();
    expect(completed.output).toMatch(/0 case\(s\) pass at base/);
    expect(completed.evidence).toMatchObject({ base_run: { completed: true }, passing_at_base: [] });
    expect(completed.evidence.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(completed.evidence.digest).not.toBe(stopped.evidence.digest);
  });

  it("a base run heavy-lock refused (exit 76) is named as that", async () => {
    await vitestReceipt(join(scratch, "never"));
    repo.write("scripts/heavy-lock.sh", "#!/bin/sh\necho 'load guard: machine busy' >&2\nexit 76\n");
    chmodSync(join(repo.root, "scripts/heavy-lock.sh"), 0o755);
    expectIncomplete(await replay(), /heavy-lock refused the run \(exit 76\)/);
  });

  it("a Rust base run that did not compile is named as a compile error", async () => {
    repo.write("src-tauri/Cargo.toml", '[package]\nname = "tauri-app"\nversion = "0.0.0"\nedition = "2021"\n');
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    1\n}\n");
    repo.cargoOutput("", "error[E0425]: cannot find value `x` in this scope\nerror: could not compile `tauri-app` (lib test) due to 1 previous error\n", 101);
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("fake-cargo/judge.json", JSON.stringify([{ target: "tauri_app_lib", name: "tests::v", file: "src/lib.rs", testMarker: "TEST_MARKER", prodMarker: "// FIXED", assertText: "assert!(false)", message: "assertion failed: false" }]));
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    // TEST_MARKER\n    #[test]\n    fn v() {\n        assert!(false);\n    }\n}\n");
    await repo.commit("spec");
    const recorded = await repo.entry("record", "--id", "A", "--lane", "rust", "--test", "src-tauri/src/lib.rs");
    expect(recorded.status, recorded.output).toBe(0);
    repo.write("src-tauri/src/lib.rs", "pub fn value() -> i32 {\n    // FIXED\n    2\n}\n\n#[cfg(test)]\nmod tests {\n    // TEST_MARKER\n    #[test]\n    fn v() {\n        assert!(false);\n    }\n}\n");
    forgetEntries();
    await repo.commit("fix");
    expectIncomplete(await replay(), /compile error/);
  });
});
