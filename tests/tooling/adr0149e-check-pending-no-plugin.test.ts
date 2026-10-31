// @vitest-environment node
/**
 * ADR0149E-F2CI (fix 2, the Linux CI failure): on a runner with no tdd-guardian plugin cache
 * (CI), a branch without receipts of its own passes, and a branch receipt is judged by the
 * vendored engine (#566), never passed silently. A missing engine is T566-3's case.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, entryScript, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 120_000 });
let repo: ReceiptRepo, home: string;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); home = mkdtempSync(join(tmpdir(), "mdpro-f2ci-home-")); });
afterEach(async () => { await repo.close(); rmSync(home, { recursive: true, force: true }); });

const checkPending = () => repo.run(process.execPath, [entryScript, "check-pending", "--cwd", repo.root], { HOME: home });
const receipt = (id: string) => ({ id, lane: "unit-red", recorded_at: "2026-10-30T00:00:00.000Z", verdict: "SEPARATION-HELD", red: { kind: "assertion-failure" }, test_files: { "tests/a.test.ts": {} } });

describe("ADR0149E-F2CI check-pending on a runner without the plugin", () => {
  it("passes a branch with no receipts of its own", async () => {
    repo.write(".claude/tdd-guardian/receipts.json", JSON.stringify({ schemaVersion: 2, receipts: [receipt("M")] }));
    await repo.commit("master receipt");
    await repo.git("branch", "-f", "master", "HEAD");
    const result = await checkPending();
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/^No unsettled, invalid or unevidenced branch receipts\.$/m);
  });

  it("passes a master store larger than Node's default subprocess buffer", async () => {
    repo.write(".claude/tdd-guardian/receipts.json", `${JSON.stringify({ schemaVersion: 2, receipts: [] })}${" ".repeat(2 * 1024 * 1024)}`);
    await repo.commit("large store");
    await repo.git("branch", "-f", "master", "HEAD");
    const result = await checkPending();
    expect(result.status, result.output).toBe(0);
  });

  it("judges a branch receipt through the vendored engine, never passing it silently", async () => {
    repo.write(".claude/tdd-guardian/receipts.json", JSON.stringify({ schemaVersion: 2, receipts: [receipt("B")] }));
    await repo.commit("branch receipt");
    const result = await checkPending();
    expect(result.status, result.output).toBe(1);
    expect(result.stderr).toMatch(/^  B \(unit-red\): .*no evidence/m);
    expect(result.stdout).not.toMatch(/No unsettled/);
  });
});
