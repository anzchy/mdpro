// @vitest-environment node
/**
 * ADR0149E-F2G1b (fix 2, final review M3, L5 and the idempotence law): normaliseText keeps
 * a temp path's `:line:col`, is idempotent, and is applied to a pre-entry base run's error
 * before that error enters the digest. ADR0149E-F3C (fix 3, gpt-auditor round two H1):
 * a duration is normalised only inside the runner's own timing spans.
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
    for (const text of ["at /tmp/a/b.ts:3:4 took 12 ms, pid 9 at 2026-10-30T01:02:03Z", "<worktree>/x <tmp> <duration> pid <pid> <timestamp>", "expected 1 to be 2", " ✓ v (12 ms)\n   Start at  09:32:01\n   Duration  1.20s (transform 20ms)\ntest result: ok. 1 passed; finished in 0.01s"]) {
      expect(n(n(text))).toBe(n(text));
    }
  });
});

describe("ADR0149E-F3C durations are normalised only inside the runner's timing spans", () => {
  it("keeps an assertion value next to a timing span and normalises the span", () => {
    expect(n("AssertionError: expected '10ms' to be '20ms'\n ✓ tests/a.test.ts (1 test) 12ms")).toBe("AssertionError: expected '10ms' to be '20ms'\n ✓ tests/a.test.ts (1 test) <duration>");
    expect(n(" ✓ expected '10ms' 3ms")).toBe(" ✓ expected '10ms' <duration>");
    expect(n("   ✓ v (12 ms)")).toBe("   ✓ v (<duration>)");
    expect(n(" ✓ tests/a.test.ts (1 test) 1.52s")).toBe(" ✓ tests/a.test.ts (1 test) <duration>");
    expect(n("line one\r\n ✓ v 12ms\r\nline three")).toBe("line one\r\n ✓ v <duration>\r\nline three");
  });

  it("rewrites each named span", () => {
    expect(n("   Duration  1.20s (transform 20ms, setup 0ms, collect 30ms, tests 2ms, environment 0ms, prepare 50ms)")).toBe("   Duration  <duration> (transform <duration>, setup <duration>, collect <duration>, tests <duration>, environment <duration>, prepare <duration>)");
    expect(n("   Start at  09:32:01")).toBe("   Start at  <timestamp>");
    expect(n("test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s")).toBe("test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in <duration>");
    expect(n("    Finished `test` profile [unoptimized + debuginfo] target(s) in 1m 05s")).toBe("    Finished `test` profile [unoptimized + debuginfo] target(s) in <duration>");
    expect(n("    Finished `test` profile [unoptimized + debuginfo] target(s) in 12.34s")).toBe("    Finished `test` profile [unoptimized + debuginfo] target(s) in <duration>");
  });

  it("leaves every duration or clock outside a span raw", () => {
    for (const text of ["took 1234 ms, then 2.5s, then 40ns", "expected 2ms to be 3ms", "Test timed out in 5000ms.", "   → expected '10ms'", "run Duration 5s", "the build Finished in 4s", "at 09:32:01 the lock expired", "expected 'job finished in 2s'", "    - waited 10ms\n    + waited 20ms"]) {
      expect(n(text)).toBe(text);
    }
  });

  it("keeps apart what differs outside a span and merges what differs only inside one", () => {
    const apart = [
      ["expected 2ms to be 3ms", "expected 4ms to be 3ms"], ["expected '10ms'", "expected '20ms'"], [" ✓ expected '10ms' 3ms", " ✓ expected '20ms' 3ms"],
      ["expected 'job finished in 2s'", "expected 'job finished in 3s'"], ["expected '09:32:01'", "expected '10:00:00'"], ["    + waited 10ms", "    + waited 20ms"],
    ];
    for (const [a, b] of apart) expect(n(a), `${a} | ${b}`).not.toBe(n(b));
    const merged = [
      ...["✓", "✔", "×", "✗", "↓"].map((mark) => [` ${mark} t 12ms`, ` ${mark} t 34ms`]),
      [" ❯ tests/a.test.ts (1 test | 1 failed) 12ms", " ❯ tests/a.test.ts (1 test | 1 failed) 34ms"],
      [" ✓ tests/a.test.ts (1 test) 1.52s", " ✓ tests/a.test.ts (1 test) 980ms"],
      ["   Duration  1.20s (transform 20ms, tests 2ms)", "   Duration  3.40s (transform 70ms, tests 9ms)"],
      ["   Start at  09:32:01", "   Start at  23:59:59"],
      ["test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s", "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.23s"],
      ["    Finished `test` profile [unoptimized + debuginfo] target(s) in 1m 05s", "    Finished `test` profile [unoptimized + debuginfo] target(s) in 12.34s"],
    ];
    for (const [a, b] of merged) {
      expect(n(a), `${a} | ${b}`).toBe(n(b));
      expect(n(a)).toMatch(/<duration>|<timestamp>/);
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
