// @vitest-environment node
/**
 * ADR0149E-6 (AC-6, ADR-0145 d5): the holes. `check-pending` judges branch receipts on
 * every lane; `verify` routes any change of the spec files' bytes since RED (insertions,
 * blank lines, a committed early return, the second of two files) to evidence even when
 * the plugin says HELD; a HELD receipt whose spec changed after settlement is flagged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const spec = 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  expect(v()).toBe(2);\n});\n';
async function red(files: Record<string, string> = { "tests/a.test.ts": spec }) {
  repo.write("src/calc.mjs", "export const v = () => 1;\n");
  for (const [path, text] of Object.entries(files)) repo.write(path, text);
  await repo.commit("red");
  const recorded = await repo.entry("record", "--id", "A", ...Object.keys(files).flatMap((file) => ["--test", file]));
  expect(recorded.status, recorded.output).toBe(0);
  repo.write("src/calc.mjs", "export const v = () => 2;\n");
}
const pending = async () => { const result = await repo.entry("check-pending"); return { status: result.status, output: result.output }; };

describe.skipIf(!pluginVersion)("ADR0149E-6 holes", () => {
  it("settles unchanged bytes through the entry, and flags branch receipts on any lane that lack evidence", async () => {
    await red();
    const verified = await repo.entry("verify", "--id", "A");
    expect(verified.status, verified.output).toBe(0);
    const entry = repo.evidence().entries.A;
    expect(entry.settled_blobs).toEqual({ "tests/a.test.ts": (await repo.git("hash-object", "tests/a.test.ts")).stdout.trim() });
    expect(entry.evidence_required).toBeUndefined();
    expect((await pending()).status).toBe(0);
    const file = ".claude/tdd-guardian/receipts.json";
    const store = JSON.parse(repo.read(file));
    for (const [id, lane] of [["U", "unit"], ["S", "slow"], ["R", "rust"]]) store.receipts.push({ ...store.receipts[0], id, lane });
    repo.write(file, JSON.stringify(store));
    const flagged = await pending();
    expect(flagged.status).toBe(1);
    for (const id of ["U (unit)", "S (slow)", "R (rust)"]) expect(flagged.output).toContain(`${id}: no evidence`);
    expect(flagged.output).not.toMatch(/^\s+A \(/m);
  });

  it("routes an inserted early return to evidence although the plugin holds", async () => {
    await red();
    repo.write("tests/a.test.ts", spec.replace('it("v", () => {\n', 'it("v", () => {\n  return;\n'));
    const verified = await repo.entry("verify", "--id", "A");
    expect(verified.status).not.toBe(0);
    expect(repo.store()[0].verdict).toBe("SEPARATION-HELD");
    expect(repo.evidence().entries.A.evidence_required).toBe(true);
    expect((await pending()).output).toMatch(/A \(unit-red\): evidence required/);
  });

  it("routes a blank-line-only insertion to evidence", async () => {
    await red();
    repo.write("tests/a.test.ts", `${spec}\n\n`);
    expect((await repo.entry("verify", "--id", "A")).status).not.toBe(0);
    expect(repo.evidence().entries.A.evidence_required).toBe(true);
  });

  it("compares against the RED bytes, not HEAD: a committed early return in the second of two files is flagged", async () => {
    await red({ "tests/a.test.ts": spec, "tests/b.test.ts": spec.replace('"v"', '"w"') });
    repo.write("tests/b.test.ts", spec.replace('"v"', '"w"').replace('it("w", () => {\n', 'it("w", () => {\n  return;\n'));
    await repo.commit("early return committed");
    expect((await repo.entry("verify", "--id", "A")).status).not.toBe(0);
    expect(repo.evidence().entries.A.evidence_required).toBe(true);
  });

  it("flags a held receipt whose spec changed after settlement", async () => {
    await red();
    expect((await repo.entry("verify", "--id", "A")).status).toBe(0);
    expect((await pending()).status).toBe(0);
    repo.write("tests/a.test.ts", spec.replace("toBe(2)", "toBeGreaterThan(0)"));
    const flagged = await pending();
    expect(flagged.status).toBe(1);
    expect(flagged.output).toMatch(/A \(unit-red\): spec changed after settlement/);
  });
});
