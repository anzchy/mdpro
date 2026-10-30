// @vitest-environment node
/**
 * ADR0149E-F2G1 (fix 2, gpt-auditor round one H1 and M2): the digest binds the text the
 * auditor reads (each outcome's message, the judge's reasons, a pre-entry base run's
 * error), after a documented normalisation of what varies by nature (temp paths, the
 * replay worktree, timestamps, pids, and since fix 3 only the runner's own timing spans).
 * A changed message changes the digest; a changed temp path does not. Fix 3 (gpt-auditor
 * round two H1): a duration inside an assertion stays raw, so `'10ms'` and `'20ms'` digest
 * apart, while a nested runner's timing output still normalises.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as replayModule from "../../scripts/tdd/receipt-replay.mjs";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo, scratch: string;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); scratch = mkdtempSync(join(tmpdir(), "mdpro-f2g1-")); });
afterEach(async () => { await repo.close(); rmSync(scratch, { recursive: true, force: true }); });

async function replay(env: Record<string, string> = {}) {
  const result = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], env);
  const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
  return { ...result, digest: /^digest: ([0-9a-f]{64})$/m.exec(result.output)?.[1], evidence: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null };
}
const id = JSON.stringify(["tests/a.test.ts", "v"]);

/** A receipt whose RED assertion message is `message` (a template evaluated in the test). */
async function receipt(message: string) {
  repo.write("src/calc.mjs", "export const v = () => 1;\n");
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/a.test.ts", `import { mkdtempSync } from "node:fs";\nimport { homedir, tmpdir } from "node:os";\nimport { join } from "node:path";\nimport { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  expect(v(), ${message}).toBe(2);\n});\n`);
  await repo.commit("spec");
  const recorded = await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts");
  expect(recorded.status, recorded.output).toBe(0);
  repo.write("src/calc.mjs", "export const v = () => 2;\n");
  await repo.commit("fix");
}

/** A receipt that fails at base away from its RED line, with that base failure's message `message`. */
async function failingReceipt(message: string) {
  repo.write("src/calc.mjs", "export const v = () => 1;\nexport const w = () => false;\n");
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("src/calc.mjs", "export const v = () => 1;\nexport const w = () => true;\n");
  await repo.commit("w");
  repo.write("tests/a.test.ts", `import { mkdtempSync } from "node:fs";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\nimport { expect, it } from "vitest";\nimport { v, w } from "../src/calc.mjs";\nit("v", () => {\n  expect(w(), ${message}).toBe(true);\n  expect(v()).toBe(2);\n});\n`);
  await repo.commit("spec");
  expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
  repo.write("src/calc.mjs", "export const v = () => 2;\nexport const w = () => true;\n");
  await repo.commit("fix");
}

describe("ADR0149E-F2G1 the normalisation rules", () => {
  it("rewrites each volatile kind to its placeholder and keeps everything else", () => {
    expect(replayModule.normaliseText).toBeTypeOf("function");
    const n = (text: string, worktree = "/repo/mdpro-wt/verify-abc1234-replay-A-x1Y2z3") => replayModule.normaliseText(text, worktree);
    expect(n("at /repo/mdpro-wt/verify-abc1234-replay-A-x1Y2z3/tests/a.test.ts:4")).toBe("at <worktree>/tests/a.test.ts:4");
    expect(n(`wrote ${join(tmpdir(), "mdpro-replay-run-AbC123", "vitest.json")} ok`)).toBe("wrote <tmp> ok");
    expect(n("wrote /private/var/folders/yc/xyz/T/abc/f.json ok")).toBe("wrote <tmp> ok");
    expect(n("wrote /tmp/abc/f.json, then")).toBe("wrote <tmp>, then");
    expect(n("at 2026-10-30T01:02:03.456Z done")).toBe("at <timestamp> done");
    expect(n("worker pid 4242 died; pid=77")).toBe("worker pid <pid> died; pid <pid>");
    expect(n("expected 1 to be 2")).toBe("expected 1 to be 2");
    expect(n("expected 1 to be 2")).not.toBe(n("expected 3 to be 2"));
    expect(n("tests/a.test.ts:12 failed 3 of 5")).toBe("tests/a.test.ts:12 failed 3 of 5");
    expect(n("2 seconds and 3 sessions")).toBe("2 seconds and 3 sessions");
    for (const [a, b] of [["/Users/x/a.json", "/Users/x/b.json"], ["expected 3 strings", "expected 4 strings"], ["expected 2 msgs", "expected 3 msgs"], ["on 2026-10-29", "on 2026-10-30"], ["rapid 5", "rapid 6"]]) expect(n(a)).not.toBe(n(b));
  });
});

describe.skipIf(!pluginVersion)("ADR0149E-F2G1 the digest binds the text", () => {
  it("a changed base message changes the digest, and the normalised message is in the digest input", async () => {
    await receipt('process.env.ADR0149E_MSG ?? "m"');
    const a = await replay({ ADR0149E_MSG: "first explanation" });
    const b = await replay({ ADR0149E_MSG: "second explanation" });
    expect(a.status, a.output).toBe(0);
    expect(b.status, b.output).toBe(0);
    expect(a.evidence.replay.ids[id].base.message).toMatch(/first explanation/);
    expect(b.evidence.replay.ids[id].base.message).toMatch(/second explanation/);
    expect(a.evidence.digest_input.replay.ids[id].base.message).toMatch(/first explanation/);
    expect(a.evidence.digest_input.replay.reasons).toEqual([]);
    expect(b.digest).not.toBe(a.digest);
  });

  it("messages that differ only after their first line digest apart", async () => {
    await receipt('process.env.ADR0149E_MSG ?? "m"');
    const a = await replay({ ADR0149E_MSG: "same head\nsecond line a" });
    const b = await replay({ ADR0149E_MSG: "same head\nsecond line b" });
    expect(a.status, a.output).toBe(0);
    expect(b.digest).not.toBe(a.digest);
  });

  it("the replay worktree, a temp path, pid or timestamp in the message keeps the digest; the evidence keeps the raw text", async () => {
    mkdirSync(join(homedir(), ".cache"), { recursive: true });
    const root = mkdtempSync(join(homedir(), ".cache", "mdpro-f2g1-root-"));
    try {
      await receipt('`${process.cwd()} ${mkdtempSync(join(tmpdir(), "mdpro-f2g1-msg-"))} pid ${process.pid}, at ${new Date().toISOString()}`');
      const a = await replay({ MDPRO_REPLAY_ROOT: root });
      const b = await replay({ MDPRO_REPLAY_ROOT: root });
      expect(a.status, a.output).toBe(0);
      expect(a.evidence.replay.ids[id].base.message).toMatch(/\/mdpro-f2g1-msg-[A-Za-z0-9]{6} pid /);
      expect(a.evidence.replay.ids[id].base.message).not.toBe(b.evidence.replay.ids[id].base.message);
      expect(a.evidence.digest_input.replay.ids[id].base.message).toMatch(/^AssertionError: <worktree> <tmp> pid <pid>, at <timestamp>: expected 1 to be 2/);
      expect(b.digest).toBe(a.digest);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("a failed replay's reasons are bound: a different explanation gives a different digest", async () => {
    await failingReceipt('process.env.ADR0149E_MSG ?? "w"');
    const a = await replay({ ADR0149E_MSG: "first explanation" });
    const b = await replay({ ADR0149E_MSG: "second explanation" });
    expect(a.evidence.replay.result).toBe("failed");
    expect(a.evidence.replay.reasons.join("\n")).toMatch(/not at the RED assertion/);
    expect(a.evidence.digest_input.replay.reasons.join("\n")).toMatch(/first explanation/);
    expect(b.evidence.digest_input.replay.reasons.join("\n")).toMatch(/second explanation/);
    expect(b.digest).not.toBe(a.digest);
  });

  it("a failed replay's reasons are normalised: volatile text in them keeps the digest", async () => {
    await failingReceipt('`${mkdtempSync(join(tmpdir(), "mdpro-f2g1-msg-"))} at ${new Date().toISOString()}`');
    const a = await replay();
    const b = await replay();
    expect(a.evidence.replay.result).toBe("failed");
    expect(a.evidence.replay.reasons.join("\n")).not.toBe(b.evidence.replay.reasons.join("\n"));
    expect(a.evidence.digest_input.replay.reasons.join("\n")).toMatch(/<tmp> at <timestamp>/);
    expect(b.digest).toBe(a.digest);
  });

  it("a pre-entry base run's error is bound: a timeout and a heavy-lock refusal digest apart", async () => {
    const flag = join(scratch, "block");
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/a.test.ts", `import { existsSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  if (existsSync(${JSON.stringify(flag)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);\n  expect(v()).toBe(2);\n});\n`);
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    repo.write(".claude/tdd-guardian/evidence.json", JSON.stringify({ schemaVersion: 1, entries: {} }));
    await repo.commit("fix");
    writeFileSync(flag, "block");
    const timedOut = await replay({ MDPRO_REPLAY_TIMEOUT_MS: "1500" });
    unlinkSync(flag);
    repo.write("scripts/heavy-lock.sh", "#!/bin/sh\nexit 76\n");
    chmodSync(join(repo.root, "scripts/heavy-lock.sh"), 0o755);
    const refused = await replay();
    expect(timedOut.evidence.base_run.error).toMatch(/timed out|killed/);
    expect(refused.evidence.base_run.error).toMatch(/heavy-lock refused the run \(exit 76\)/);
    expect(timedOut.evidence.digest_input.base_run.error).toMatch(/timed out|killed/);
    expect(refused.evidence.digest_input.base_run.error).toBe("heavy-lock refused the run (exit 76)");
    expect(refused.digest).not.toBe(timedOut.digest);
  });
});

describe.skipIf(!pluginVersion)("ADR0149E-F3 a duration inside an assertion is bound", () => {
  it("F3A: messages that differ only in a time-like assertion value, '10ms' against '20ms', digest apart", async () => {
    await receipt('process.env.ADR0149E_MSG ?? "m"');
    const a = await replay({ ADR0149E_MSG: "expected '10ms'" });
    const b = await replay({ ADR0149E_MSG: "expected '20ms'" });
    expect(a.status, a.output).toBe(0);
    expect(b.status, b.output).toBe(0);
    expect(a.evidence.digest_input.replay.ids[id].base.message).toMatch(/^AssertionError: expected '10ms': expected 1 to be 2/);
    expect(b.evidence.digest_input.replay.ids[id].base.message).toMatch(/^AssertionError: expected '20ms': expected 1 to be 2/);
    expect(b.digest).not.toBe(a.digest);
  });
});

/** A failed nested Vitest run's output, as `expect(result.status, result.output)` puts it into a message. */
const nestedRun = (test: string, file: string, clock: string, total: string) => [
  "expected '10ms' from the child run:",
  ` ❯ tests/x.test.ts (2 tests | 1 failed) ${file}`,
  `   × fails ${test}`,
  "     → expected 1 to be 2",
  `   ✓ passes ${test}`,
  "",
  " Test Files  1 failed (1)",
  "      Tests  1 failed | 1 passed (2)",
  `   Start at  ${clock}`,
  `   Duration  ${total} (transform 20ms, setup 0ms, collect ${test}, tests ${test}, environment 0ms, prepare 50ms)`,
  "end of child output",
].join("\n");

describe.skipIf(!pluginVersion)("ADR0149E-F3 the runner's timing output is normalised", () => {
  it("F3B: two copies of one failure whose nested runner timing differs digest equal, and the assertion value stays", async () => {
    await receipt('process.env.ADR0149E_MSG ?? "m"');
    const a = await replay({ ADR0149E_MSG: nestedRun("12ms", "15ms", "09:32:01", "1.20s") });
    const b = await replay({ ADR0149E_MSG: nestedRun("340ms", "1.52s", "10:00:00", "2.50s") });
    expect(a.status, a.output).toBe(0);
    expect(b.status, b.output).toBe(0);
    expect(a.evidence.replay.ids[id].base.message).not.toBe(b.evidence.replay.ids[id].base.message);
    expect(b.digest).toBe(a.digest);
    const digested = a.evidence.digest_input.replay.ids[id].base.message;
    expect(digested).toContain("expected '10ms' from the child run:");
    expect(digested).toContain(" ❯ tests/x.test.ts (2 tests | 1 failed) <duration>\n   × fails <duration>\n");
    expect(digested).toContain("   Start at  <timestamp>\n   Duration  <duration> (transform <duration>, setup <duration>,");
    expect(digested).not.toMatch(/12ms|09:32:01|1\.20s/);
  });
});
