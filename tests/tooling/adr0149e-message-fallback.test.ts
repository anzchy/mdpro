// @vitest-environment node
/**
 * ADR0149E-F1M1 (fix 1, opus-auditor round one M1): when the RED line no longer maps, the
 * message fallback still requires the base failure to sit in the RED's file; the same
 * message raised from a helper in another file is not the RED assertion.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

describe.skipIf(!pluginVersion)("ADR0149E-F1M1 the message fallback checks the file", () => {
  it("fails when the base raises the RED message from another file after the RED line was edited", async () => {
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/calc.test.ts", 'import { expect, it } from "vitest";\nimport * as calc from "../src/calc.mjs";\nit("x", () => {\n  expect(calc.v()).toBe(5);\n});\n');
    await repo.commit("red");
    const recorded = await repo.entry("record", "--id", "A", "--test", "tests/calc.test.ts");
    expect(recorded.status, recorded.output).toBe(0);
    repo.write("src/calc.mjs", "export const v = () => 5;\n");
    repo.write("tests/helper.ts", 'import { expect } from "vitest";\nexport function check(value: number) {\n  expect(value).toBe(5);\n}\n');
    repo.write("tests/calc.test.ts", 'import { it } from "vitest";\nimport * as calc from "../src/calc.mjs";\nimport { check } from "./helper";\nit("x", () => {\n  check(calc.v());\n});\n');
    await repo.commit("head");
    const result = await repo.entry("replay", "--id", "A");
    const path = /^evidence: (.+)$/m.exec(result.output)?.[1];
    const evidence = path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    expect(evidence?.replay?.ids?.[JSON.stringify(["tests/calc.test.ts", "x"])]?.base?.location?.file).toBe("tests/helper.ts");
    expect(result.status).not.toBe(0);
    expect(evidence?.replay?.result).toBe("failed");
    expect((evidence?.replay?.reasons ?? []).join("\n")).toMatch(/not at the RED assertion/);
  });
});
