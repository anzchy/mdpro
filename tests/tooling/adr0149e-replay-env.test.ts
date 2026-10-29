// @vitest-environment node
/**
 * ADR0149E-4d (AC-4, regression found by replaying ADR0149E-3 and -4a on the real tree):
 * the replay's test runs must not inherit the entry's own lock and selection environment.
 * A leaked MDPRO_UNIT_RED_FLOCK_FD made every replayed test that spawns the entry fail
 * on a stat of a flock file in its own fixture, at base and at head alike.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

describe.skipIf(!pluginVersion)("ADR0149E-4d replay environment", () => {
  it("runs the replayed tests without the entry's lock, selection or evidence variables", async () => {
    repo.write("src/calc.mjs", "export const value = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/env.test.ts", [
      'import { expect, it } from "vitest";',
      'import { value } from "../src/calc.mjs";',
      'it("clean env", () => {',
      '  for (const key of ["MDPRO_UNIT_RED_FILES", "MDPRO_UNIT_RED_MARKER", "MDPRO_UNIT_RED_NONCE", "MDPRO_UNIT_RED_META_PATH", "MDPRO_RED_EVIDENCE_DIR"]) delete process.env[key];',
      '  expect(Object.keys(process.env).filter((key) => /^MDPRO_(UNIT_RED|RED_EVIDENCE)/.test(key) && process.env[key])).toEqual([]);',
      "  expect(value()).toBe(2);",
      "});",
      "",
    ].join("\n"));
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/env.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const value = () => 2;\n");
    await repo.commit("fix");
    const result = await repo.entry("replay", "--id", "A");
    const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
    const evidence = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    expect(evidence?.replay.reasons).toEqual([]);
    expect(result.status).toBe(0);
  });
});
