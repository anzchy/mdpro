// @vitest-environment node
/**
 * ADR0149E-F2G1b (fix 2, final review M3, L5 and the idempotence law): normaliseText keeps
 * a temp path's `:line:col`, is idempotent, and is applied to a pre-entry base run's error
 * before that error enters the digest.
 */
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as replayModule from "../../scripts/tdd/receipt-replay.mjs";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
const n = (text: string) => replayModule.normaliseText(text, "/repo/mdpro-wt/verify-abc1234-replay-A-x1Y2z3");

describe("ADR0149E-F2G1b normaliseText laws", () => {
  it("keeps the line and column after a temp path, so two locations stay apart", () => {
    expect(n("at /tmp/run-1/x.ts:12:5")).toBe("at <tmp>:12:5");
    expect(n("at /tmp/run-1/x.ts:12:5")).not.toBe(n("at /tmp/run-2/x.ts:40:1"));
  });

  it("is idempotent", () => {
    for (const text of ["at /tmp/a/b.ts:3:4 took 12 ms, pid 9 at 2026-10-30T01:02:03Z", "<worktree>/x <tmp> <duration> pid <pid> <timestamp>", "expected 1 to be 2"]) {
      expect(n(n(text))).toBe(n(text));
    }
  });
});

let repo: ReceiptRepo;
describe.skipIf(!pluginVersion)("ADR0149E-F2G1b a pre-entry base run's error is normalised in the digest", () => {
  beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
  afterEach(async () => { await repo.close(); });

  it("a run that could not start names its path raw in the evidence and as <tmp> in the digest input", async () => {
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  expect(v()).toBe(2);\n});\n');
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    repo.write(".claude/tdd-guardian/evidence.json", JSON.stringify({ schemaVersion: 1, entries: {} }));
    await repo.commit("fix");
    repo.write("scripts/heavy-lock.sh", "#!/bin/sh\nexec \"$@\"\n");
    chmodSync(join(repo.root, "scripts/heavy-lock.sh"), 0o644);
    const result = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], {});
    const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
    const evidence = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    expect(evidence?.base_run.error).toMatch(/did not start/);
    expect(evidence.base_run.error).toContain("scripts/heavy-lock.sh");
    expect(evidence.digest_input.base_run.error).toBe(replayModule.normaliseText(evidence.base_run.error, []));
    expect(evidence.digest_input.base_run.error).toMatch(/<tmp>/);
    expect(evidence.digest_input.base_run.error).not.toContain("scripts/heavy-lock.sh");
  });
});
