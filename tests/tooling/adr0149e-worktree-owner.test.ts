// @vitest-environment node
/**
 * ADR0149E-F2G2b (fix 2, gpt-auditor round one H2; opus-auditor round two N2 and N5; the
 * first record, ADR0149E-F2G2, came out as an environment RED): a replay removes only a
 * worktree it added itself. Two replays of the same id and head from
 * two checkouts of one repository each get their own worktree, and a stale marker left in
 * the OS-lock file by an earlier, killed operation removes nothing.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, entryScript, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo, scratch: string;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); scratch = realpathSync(mkdtempSync(join(tmpdir(), "mdpro-f2g2-"))); });
afterEach(async () => {
  writeFileSync(join(scratch, "release"), "go");
  writeFileSync(join(scratch, "go-b"), "go");
  await repo.close();
  rmSync(scratch, { recursive: true, force: true });
});

const until = async (check: () => boolean, ms: number) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return check(); };
const registered = async () => (await repo.git("worktree", "list", "--porcelain")).stdout.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => realpathSync.native(line.slice(9)));
const replayRoot = () => join(scratch, "wt");
/** The `git` the PATH resolves to, found without a child process. */
const realGit = () => (process.env.PATH ?? "").split(":").map((dir) => join(dir, "git")).find((path) => existsSync(path)) ?? "git";

/** A receipt whose base run, when ADR0149E_HOLD names a folder, writes its cwd there and waits for `release`. */
async function holdingReceipt() {
  repo.write("src/calc.mjs", "export const v = () => 1;\n");
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("tests/a.test.ts", 'import { existsSync, writeFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { expect, it } from "vitest";\nimport { v } from "../src/calc.mjs";\nit("v", () => {\n  const hold = process.env.ADR0149E_HOLD;\n  if (hold) { writeFileSync(join(hold, "running"), process.cwd()); const end = Date.now() + 60_000; while (!existsSync(join(hold, "release")) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }\n  expect(v()).toBe(2);\n});\n');
  await repo.commit("spec");
  const recorded = await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts");
  expect(recorded.status, recorded.output).toBe(0);
  repo.write("src/calc.mjs", "export const v = () => 2;\n");
  await repo.commit("fix");
}

/** A `git` on PATH that holds the first `git worktree add` until `go-b` exists. */
function holdingGit() {
  const bin = join(scratch, "bin"), real = realGit();
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = add ] && [ ! -e "${scratch}/b-added" ]; then\n  : > "${scratch}/b-at-add"\n  i=0; while [ ! -e "${scratch}/go-b" ] && [ $i -lt 1200 ]; do sleep 0.05; i=$((i+1)); done\n  : > "${scratch}/b-added"\nfi\nexec "${real}" "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  return `${bin}:${process.env.PATH ?? ""}`;
}

describe.skipIf(!pluginVersion)("ADR0149E-F2G2b a replay removes only its own worktree", () => {
  it("two checkouts replaying the same id and head at once: the first one's worktree survives the second", async () => {
    await holdingReceipt();
    const second = join(scratch, "checkout-2");
    expect((await repo.git("worktree", "add", "-q", "--detach", second, "HEAD")).status).toBe(0);
    const hold = join(scratch, "hold-a");
    mkdirSync(hold);
    const env = { MDPRO_REPLAY_ROOT: replayRoot() };
    const b = repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", second], { ...env, PATH: holdingGit() });
    b.catch(() => {}); // a failed assertion below leaves it to the owner's cancel
    expect(await until(() => existsSync(join(scratch, "b-at-add")), 60_000)).toBe(true);
    const a = repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], { ...env, ADR0149E_HOLD: hold });
    a.catch(() => {});
    expect(await until(() => existsSync(join(hold, "running")), 90_000)).toBe(true);
    const aWorktree = realpathSync.native(readFileSync(join(hold, "running"), "utf8"));
    writeFileSync(join(scratch, "go-b"), "go");
    const bDone = await b;
    expect(existsSync(join(aWorktree, "tests/a.test.ts"))).toBe(true);
    expect(await registered()).toContain(aWorktree);
    writeFileSync(join(hold, "release"), "go");
    const aDone = await a;
    expect(aDone.output).toMatch(/^replay: passed$/m);
    expect(aDone.status, aDone.output).toBe(0);
    expect(bDone.output).toMatch(/^replay: passed$/m);
    expect(bDone.status, bDone.output).toBe(0);
  });

  it("a foreign worktree registered at the replay's own path just before its add survives the entry and the launcher", async () => {
    await holdingReceipt();
    const bin = join(scratch, "bin-foreign"), real = realGit();
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = add ] && [ ! -e "${scratch}/foreign" ]; then\n  printf %s "$5" > "${scratch}/foreign"\n  "${real}" worktree add -q --detach "$5" "$6" >/dev/null 2>&1\nfi\nexec "${real}" "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const result = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], { MDPRO_REPLAY_ROOT: replayRoot(), PATH: `${bin}:${process.env.PATH ?? ""}` });
    expect(result.status).not.toBe(0);
    const foreignPath = readFileSync(join(scratch, "foreign"), "utf8");
    expect(existsSync(join(foreignPath, ".git"))).toBe(true);
    const foreign = realpathSync.native(foreignPath);
    expect(await registered()).toContain(foreign);
    expect(readdirSync(replayRoot()).map((name) => join(realpathSync.native(replayRoot()), name))).toEqual([foreign]);
    expect(readFileSync(join(repo.root, ".claude/tdd-guardian/.unit-red-A.flock"), "utf8")).toBe("");
  });

  it("a finished replay leaves no worktree and no directory behind", async () => {
    await holdingReceipt();
    const done = await repo.run(process.execPath, [entryScript, "replay", "--id", "A", "--cwd", repo.root], { MDPRO_REPLAY_ROOT: replayRoot() });
    expect(done.status, done.output).toBe(0);
    expect((await registered()).filter((path) => path.includes("-replay-"))).toEqual([]);
    expect(existsSync(replayRoot()) ? readdirSync(replayRoot()) : []).toEqual([]);
  });
});

describe("ADR0149E-F2G2b a stale marker removes nothing", () => {
  it.each(["verify", "replay"])("%s of that id leaves a foreign worktree named by a stale marker alone", async (action) => {
    const foreign = join(scratch, "verify-0000000-replay-A");
    expect((await repo.git("worktree", "add", "-q", "--detach", foreign, "HEAD")).status).toBe(0);
    const flock = join(repo.root, ".claude/tdd-guardian/.unit-red-A.flock");
    writeFileSync(flock, foreign);
    const result = await repo.entry(action, "--id", "A");
    expect(result.status).toBe(64);
    expect(existsSync(join(foreign, ".git"))).toBe(true);
    expect(await registered()).toContain(foreign);
    expect(readFileSync(flock, "utf8")).toBe("");
  });
});
