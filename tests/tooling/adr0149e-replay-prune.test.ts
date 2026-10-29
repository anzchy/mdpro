// @vitest-environment node
/**
 * ADR0149E-4e (AC-4, review finding M2): a replay removes only its own worktree. A
 * repo-wide `git worktree prune` would also drop another session's prunable record (a
 * worktree moved by `mv`), after which `git worktree repair` can no longer reattach it.
 * Paths are compared through realpath: git reports `/private/var/…` for `/var/…` on macOS.
 */
import { realpathSync, renameSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

describe.skipIf(!pluginVersion)("ADR0149E-4e replay worktree hygiene", () => {
  it("leaves another worktree's prunable record alone and removes its own", async () => {
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  expect(v()).toBe(2);\n});\n');
    await repo.commit("spec");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts")).status).toBe(0);
    repo.write("src/calc.mjs", "export const v = () => 2;\n");
    await repo.commit("fix");
    const other = join(realpathSync(repo.root), "..", `${repo.root.split("/").at(-1)}-moved`);
    await repo.git("worktree", "add", "-q", "--detach", other, "HEAD");
    renameSync(other, `${other}-elsewhere`);
    expect((await repo.entry("replay", "--id", "A")).output).toMatch(/^replay: passed/m);
    const list = (await repo.git("worktree", "list", "--porcelain")).stdout;
    expect(list).toContain(`worktree ${other}`);
    expect(list).not.toMatch(/replay-A/);
    await repo.run("rm", ["-rf", `${other}-elsewhere`]);
  });
});
