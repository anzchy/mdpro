// @vitest-environment node
/**
 * ADR0149E-5b (AC-5, review findings M1 and L5): the digest covers a stable projection of
 * the replay, meaning each id's status, kind, location and message at base and head, the
 * reasons and the result. Since fix 2 (gpt-auditor H1) the message is bound after
 * normalisation, so a failure message that embeds a varying duration does not change the
 * digest between two replays of the same base and head. The head's test tree is the tree
 * of exactly the head's test paths.
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
  return { ...result, digest: /^digest: ([0-9a-f]{64})$/m.exec(result.output)?.[1], evidence: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null };
}

describe.skipIf(!pluginVersion)("ADR0149E-5b stable digest", () => {
  it("digests status, kind, location and normalised message, so a varying duration in the message keeps the digest", async () => {
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  expect(v(), `run took ${performance.now()} ms`).toBe(2);\n});\n');
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    await repo.commit("fix");
    const first = await replay();
    const second = await replay();
    expect(first.evidence.replay.result).toBe("passed");
    const id = JSON.stringify(["tests/a.test.ts", "v"]);
    expect(first.evidence.replay.ids[id].base.message).not.toBe(second.evidence.replay.ids[id].base.message);
    expect(first.evidence.digest_input.replay).toEqual({
      result: "passed",
      reasons: [],
      ids: { [id]: { base: { status: "failed", kind: "assertion", location: { file: "tests/a.test.ts", line: 4 }, message: "AssertionError: run took <duration>: expected 1 to be 2 // Object.is equality" }, head: { status: "passed", kind: null, location: null, message: "" } } },
    });
    expect(second.digest).toBe(first.digest);
    const tree = first.evidence.digest_input.head_tests_tree;
    expect((await repo.git("ls-tree", "--name-only", tree)).stdout.trim().split("\n")).toEqual(["tests"]);
    expect((await repo.git("rev-parse", `${tree}:tests`)).stdout.trim()).toBe((await repo.git("rev-parse", "HEAD:tests")).stdout.trim());
  });
});
