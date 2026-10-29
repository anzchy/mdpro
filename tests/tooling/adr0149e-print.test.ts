// @vitest-environment node
/**
 * ADR0149E-3 (AC-3, ADR-0149 d2 "print"): `replay --id` writes an evidence file holding
 * the RED → head diff of the whole test tree (pin against the head commit's test paths)
 * and the base → head diff of the non-test paths, base being the merge-base.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

async function evidence() {
  const result = await repo.entry("replay", "--id", "A");
  const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
  expect(existsSync(path), result.output).toBe(true);
  return JSON.parse(readFileSync(path, "utf8")) as { test_diff: string; prod_diff: string };
}

async function recorded() {
  repo.write("src/calc.mjs", "export const v = () => 1;\n");
  repo.write("tests/support/s.ts", "export const two = 2;\n");
  repo.write("tests/gone.test.ts", "export {};\n");
  repo.write("src-tauri/src/lib.rs", "pub fn p() {}\n\n#[cfg(test)]\nmod tests {\n    // RED_MODULE\n}\n");
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nimport { two } from "./support/s";\nit("v", () => {\n  expect(v()).toBe(two);\n});\n');
  await repo.commit("spec");
  expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
  await repo.commit("receipt");
}

describe.skipIf(!pluginVersion)("ADR0149E-3 the print", () => {
  it("diffs the RED tree against the head commit's test paths and base against head for production", async () => {
    await recorded();
    await repo.git("switch", "-q", "master");
    repo.write("src/unrelated.mjs", "export const MASTER_ONLY = 1;\n");
    await repo.commit("unrelated master work");
    await repo.git("switch", "-q", "feature");
    repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nimport { two } from "./support/s";\nit("v", () => {\n  expect(v()).toBeGreaterThan(1);\n});\n');
    repo.write("tests/support/s.ts", "export const two = 3;\n");
    repo.write("tests/later.test.ts", "export const LATER = 1;\n");
    await repo.git("rm", "-q", "tests/gone.test.ts");
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    repo.write("src-tauri/src/lib.rs", "pub fn p() {\n    // PROD_CHANGE\n}\n\n#[cfg(test)]\nmod tests {\n    // HEAD_MODULE\n}\n");
    await repo.commit("head");
    repo.write("tests/support/s.ts", "export const two = 'DIRTY_UNCOMMITTED';\n");
    const e = await evidence();
    expect(e.test_diff).toContain("-  expect(v()).toBe(two);");
    expect(e.test_diff).toContain("+  expect(v()).toBeGreaterThan(1);");
    expect(e.test_diff).toContain("+export const two = 3;");
    expect(e.test_diff).toContain("+export const LATER = 1;");
    expect(e.test_diff).toMatch(/deleted file mode[\s\S]*tests\/gone\.test\.ts|tests\/gone\.test\.ts[\s\S]*deleted file mode/);
    expect(e.test_diff).toContain("+    // HEAD_MODULE");
    expect(e.test_diff).not.toContain("DIRTY_UNCOMMITTED");
    expect(e.prod_diff).toContain("+export const v = () => 2;");
    expect(e.prod_diff).toContain("+    // PROD_CHANGE");
    expect(e.prod_diff).not.toMatch(/^diff --git a\/tests\//m);
    expect(e.prod_diff).not.toContain("MASTER_ONLY");
  });

  it("writes an empty test diff when nothing under test changed since RED", async () => {
    await recorded();
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    await repo.commit("head");
    const e = await evidence();
    expect(e.test_diff).toBe("");
    expect(e.prod_diff).toContain("+export const v = () => 2;");
  });
});
