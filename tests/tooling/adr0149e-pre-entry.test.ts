// @vitest-environment node
/**
 * ADR0149E-7 (AC-7, ADR-0149 d4; ADR-0145 d6): a receipt with no current sidecar entry
 * (recorded before the entry, or stale) takes the replay only as far as it can run: the
 * head's spec files against base production, listing every case that passes there, and
 * marking the receipt for a user ruling.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

async function replay() {
  const result = await repo.entry("replay", "--id", "A");
  const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
  return { ...result, evidence: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null };
}
const id = (title: string) => JSON.stringify(["tests/new.test.ts", title]);

/** A spec file the branch adds: `a` passes at base, `b` fails at base and passes at head. */
async function mixed(bValueAtBase = "1") {
  repo.write("src/calc.mjs", `export const v = () => ${bValueAtBase};\n`);
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/new.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("a", () => {\n  expect(1).toBe(1);\n});\nit("b", () => {\n  expect(v()).toBe(2);\n});\n');
  await repo.commit("spec");
  expect((await repo.entry("record", "--id", "A", "--test", "tests/new.test.ts")).status).toBe(0);
  repo.write("src/calc.mjs", "export const v = () => 2;\n");
  await repo.commit("head");
}

describe.skipIf(!pluginVersion)("ADR0149E-7 pre-entry receipts", () => {
  it("lists exactly the cases that pass at base and requires a user ruling", async () => {
    await mixed();
    repo.write(".claude/tdd-guardian/evidence.json", JSON.stringify({ schemaVersion: 1, entries: {} }));
    const result = await replay();
    expect(result.status).not.toBe(0);
    expect(result.evidence).toMatchObject({ mode: "pre-entry", user_ruling_required: true, passing_at_base: [id("a")] });
  });

  it("reads a stale entry as no evidence and builds no RED diff from an older pin", async () => {
    await mixed();
    const store = repo.evidence();
    store.entries.A.recorded_at = "2020-01-01T00:00:00.000Z";
    repo.write(".claude/tdd-guardian/evidence.json", JSON.stringify(store));
    const result = await replay();
    expect(result.evidence.mode).toBe("pre-entry");
    expect(result.evidence.test_diff).toBeUndefined();
    expect(result.evidence.passing_at_base).toEqual([id("a")]);
  });

  it("lists nothing when every case fails at base, and still requires the ruling", async () => {
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/new.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("b", () => {\n  expect(v()).toBe(2);\n});\n');
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/new.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    repo.write(".claude/tdd-guardian/evidence.json", JSON.stringify({ schemaVersion: 1, entries: {} }));
    await repo.commit("head");
    expect((await replay()).evidence).toMatchObject({ mode: "pre-entry", user_ruling_required: true, passing_at_base: [] });
  });
});
