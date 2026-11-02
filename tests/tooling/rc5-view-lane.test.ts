// @vitest-environment node
/**
 * RC5 pin P1 (AC-3): the unit-red lane's identity check reads the receipt's item file, so a
 * change made only to the receipts.json view during verify has no effect. No RED: S4 built it;
 * a mutation that reads the view fails this case. Kept out of S5b's settled spec file.
 * Matrix row: P1 (view half; the item-file half is unit-red-lane's selection test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
const T = ".claude/tdd-guardian", R = `${T}/receipts`, VIEW = `${T}/receipts.json`;
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const item = (id: string) => JSON.parse(repo.read(`${R}/${id}.json`));
const SPEC = [
  'import { expect, it } from "vitest";',
  'import { v } from "../src/x.mjs";',
  'it("v is two", () => { expect(v).toBe(2); });',
].join("\n");
function failing(file = "tests/a.test.ts") { repo.write(file, SPEC); repo.write("src/x.mjs", "export const v = 1;\n"); }
const record = (id: string) => repo.run(process.execPath, [entryScript, "record", "--id", id, "--test", "tests/a.test.ts", "--cwd", repo.root]);

describe.skipIf(!pluginVersion)("RC5 the lane ignores the view (P1)", () => {
  it("P1: the lane's identity check reads the item file, so a view changed during verify has no effect", async () => {
    failing();
    expect((await record("A-1")).status).toBe(0);
    repo.write("src/x.mjs", "export const v = 2;\n");
    // The unit-red lane runs through a wrapper that rewrites A-1's selection in the view only.
    repo.write("scripts/tdd/view-wrapper.mjs", [
      'import { readFileSync, writeFileSync } from "node:fs"; import { spawn } from "node:child_process";',
      `const p = "${VIEW}"; const s = JSON.parse(readFileSync(p, "utf8"));`,
      's.receipts.find((r) => r.id === "A-1").test_files["tests/b.test.ts"] = s.receipts.find((r) => r.id === "A-1").test_files["tests/a.test.ts"];',
      'writeFileSync(p, JSON.stringify(s, null, 2) + "\\n");',
      'spawn(process.execPath, ["scripts/tdd/unit-red-lane.mjs"], { stdio: "inherit", env: process.env }).on("exit", (code) => process.exit(code ?? 64));',
    ].join("\n"));
    const config = JSON.parse(repo.read(`${T}/config.json`));
    config.lanes.find((lane: { name: string }) => lane.name === "unit-red").command = "node scripts/tdd/view-wrapper.mjs";
    repo.write(`${T}/config.json`, JSON.stringify(config));
    const before = repo.read(VIEW);
    const result = await repo.entry("verify", "--id", "A-1");
    expect(result.status, result.output).toBe(0);
    expect(repo.read(VIEW)).not.toBe(before);
    expect(item("A-1").verdict).toBe("SEPARATION-HELD");
    expect(Object.keys(item("A-1").test_files)).toEqual(["tests/a.test.ts"]);
  });
});
