// @vitest-environment node
/**
 * ADR0149E-5 (AC-5, ADR-0145 d3 as extended by ADR-0149 d3): the evidence digest is the
 * sha256 of canonical JSON (keys sorted at every level, no whitespace) over exactly the
 * receipt id, recorded-at, pinned tree, PR base and head SHAs, the head's test tree,
 * the spec blobs at head and the replay output; any change of base or head is a mismatch.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
    : JSON.stringify(value);

async function replay(...extra: string[]) {
  const result = await repo.entry("replay", "--id", "A", ...extra);
  const path = /^evidence: (.+)$/m.exec(result.output)?.[1] ?? "";
  return { ...result, digest: /^digest: ([0-9a-f]{64})$/m.exec(result.output)?.[1], evidence: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null };
}
const rev = async (spec: string) => (await repo.git("rev-parse", spec)).stdout.trim();

async function fixed() {
  repo.write("src/calc.mjs", "export const v = () => 1;\n");
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  expect(v()).toBe(2);\n});\n');
  await repo.commit("spec");
  expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
  repo.write("src/calc.mjs", "export const v = () => 2;\n");
  await repo.commit("fix");
}

describe.skipIf(!pluginVersion)("ADR0149E-5 the evidence digest", () => {
  it("digests exactly the documented inputs, each equal to git's own value, and stores the digest", async () => {
    await fixed();
    const first = await replay();
    expect(first.status, first.output).toBe(0);
    const input = first.evidence.digest_input;
    expect(Object.keys(input).sort()).toEqual(["base", "head", "head_tests_tree", "id", "recorded_at", "replay", "spec_blobs", "tests_tree"]);
    expect(first.digest).toBe(createHash("sha256").update(canonical(input)).digest("hex"));
    expect(first.evidence.digest).toBe(first.digest);
    expect(input.id).toBe("A");
    expect(input.recorded_at).toBe(repo.store()[0].recorded_at);
    expect(input.tests_tree).toBe(repo.evidence().entries.A.tests_tree.tree);
    expect(input.base).toBe(await rev("master"));
    expect(input.head).toBe(await rev("HEAD"));
    expect(input.spec_blobs).toEqual({ "tests/a.test.ts": await rev("HEAD:tests/a.test.ts") });
    expect(input.head_tests_tree).toMatch(/^[0-9a-f]{40}$/);
    expect(input.replay.result).toBe(first.evidence.replay.result);
    expect(repo.evidence().entries.A.replay).toMatchObject({ digest: first.digest, base: input.base, head: input.head });
    expect((await replay()).digest).toBe(first.digest);
  });

  it("changes on a production-only head commit and on a moved base, and --expect-digest reports the mismatch", async () => {
    await fixed();
    const first = await replay();
    repo.write("src/other.mjs", "export {};\n");
    await repo.commit("production only");
    const moved = await replay("--expect-digest", first.digest ?? "");
    expect(moved.digest).not.toBe(first.digest);
    expect(moved.status).not.toBe(0);
    expect(moved.output).toMatch(/digest mismatch/);
    const head = await replay();
    await repo.git("branch", "-f", "master", "HEAD~2");
    const rebased = await replay("--expect-digest", head.digest ?? "");
    expect(rebased.evidence.digest_input.head).toBe(head.evidence.digest_input.head);
    expect(rebased.evidence.digest_input.base).not.toBe(head.evidence.digest_input.base);
    expect(rebased.digest).not.toBe(head.digest);
    expect(rebased.output).toMatch(/digest mismatch/);
  });
});
