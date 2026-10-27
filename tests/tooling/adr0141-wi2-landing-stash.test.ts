// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";

const skill = path.resolve(".agents/skills/mdpro-delegator");
const guide = path.join(skill, "references/guide.md");
const checklist = path.join(skill, "references/templates/landing-docs-checklist.md");
const helper = path.join(skill, "scripts/landing-stash.mjs");
const dirs: string[] = [];

type Result = { code: number; stdout: string; stderr: string };

function start(command: string, args: string[], cwd: string, env = process.env) {
  const child = spawn(command, args, { cwd, env });
  let stdout = "", stderr = "";
  child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
  child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
  const done = new Promise<Result>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
  return { child, done };
}

async function run(command: string, args: string[], cwd: string, env = process.env) {
  return start(command, args, cwd, env).done;
}

async function git(cwd: string, ...args: string[]) {
  const result = await run("/usr/bin/git", args, cwd);
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr0141-stash-"));
  dirs.push(root);
  const main = path.join(root, "main");
  const linked = path.join(root, "linked");
  fs.mkdirSync(main);
  await git(main, "init", "-q");
  await git(main, "config", "user.name", "WI2 test");
  await git(main, "config", "user.email", "wi2@example.test");
  fs.writeFileSync(path.join(main, "a.md"), "base-a\n");
  fs.writeFileSync(path.join(main, "b.md"), "base-b\n");
  await git(main, "add", "a.md", "b.md");
  await git(main, "commit", "-qm", "base");
  await git(main, "worktree", "add", "-qb", "linked", linked);
  return { root, main, linked };
}

async function oids(cwd: string) {
  return (await git(cwd, "stash", "list", "--format=%H")).split("\n").filter(Boolean);
}

function invoke(cwd: string, args: string[], env = process.env) {
  return run(process.execPath, [helper, ...args], cwd, env);
}

async function waitFor(file: string) {
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fs.existsSync(file), `expected barrier ${file}`).toBe(true);
}

afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("ADR0141 WI2 landing stash identity", () => {
  it("publishes exact-OID save and apply commands without mutable stash refs", () => {
    for (const file of [guide, checklist]) {
      const body = fs.readFileSync(file, "utf8");
      expect(body).toContain("node .agents/skills/mdpro-delegator/scripts/landing-stash.mjs save --");
      expect(body).toContain("node .agents/skills/mdpro-delegator/scripts/landing-stash.mjs apply <oid>");
      expect(body).not.toMatch(/git stash pop|git stash drop|stash@\{/);
      expect(body).not.toContain("$SK/scripts/landing-stash.mjs");
    }
  });
});

describe("ADR0141 WI2 landing stash exact OID behavior", () => {
  it("saves only named dirty paths, applies the returned OID and retains the entry", async () => {
    const { main } = await makeRepo();
    fs.writeFileSync(path.join(main, "a.md"), "landing 中文\n");
    fs.writeFileSync(path.join(main, "b.md"), "unrelated\n");
    const before = await oids(main);
    const saved = await invoke(main, ["save", "--", "a.md"]);
    expect(saved.code, saved.stderr).toBe(0);
    expect(saved.stdout).toMatch(/^[0-9a-f]{40}\n$/);
    const oid = saved.stdout.trim();
    expect(await oids(main)).toEqual([oid, ...before]);
    expect(fs.readFileSync(path.join(main, "a.md"), "utf8")).toBe("base-a\n");
    expect(fs.readFileSync(path.join(main, "b.md"), "utf8")).toBe("unrelated\n");
    const preApply = await oids(main);
    const applied = await invoke(main, ["apply", oid]);
    expect(applied.code, applied.stderr).toBe(0);
    expect(fs.readFileSync(path.join(main, "a.md"), "utf8")).toBe("landing 中文\n");
    expect(fs.readFileSync(path.join(main, "b.md"), "utf8")).toBe("unrelated\n");
    expect(await oids(main)).toEqual(preApply);
  });

  it("keeps a foreign linked-worktree stash added after save", async () => {
    const { main, linked } = await makeRepo();
    fs.writeFileSync(path.join(main, "a.md"), "landing\n");
    const saved = await invoke(main, ["save", "--", "a.md"]);
    expect(saved.code, saved.stderr).toBe(0);
    const landing = saved.stdout.trim();
    const afterSave = await oids(main);
    fs.writeFileSync(path.join(linked, "b.md"), "foreign\n");
    await git(linked, "stash", "push", "-q", "-m", "foreign", "--", "b.md");
    const beforeApply = await oids(main);
    expect(beforeApply).toHaveLength(afterSave.length + 1);
    expect(beforeApply.at(-1)).toBe(landing);
    const applied = await invoke(main, ["apply", landing]);
    expect(applied.code, applied.stderr).toBe(0);
    expect(fs.readFileSync(path.join(main, "a.md"), "utf8")).toBe("landing\n");
    expect(fs.readFileSync(path.join(main, "b.md"), "utf8")).toBe("base-b\n");
    expect(await oids(main)).toEqual(beforeApply);
  });

  it("resolves its marker when a foreign push arrives before save lookup", async () => {
    const { root, main, linked } = await makeRepo();
    fs.writeFileSync(path.join(main, "a.md"), "landing\n");
    fs.writeFileSync(path.join(linked, "b.md"), "foreign\n");
    const ready = path.join(root, "save-ready"), gate = path.join(root, "save-gate");
    fs.writeFileSync(gate, "hold\n");
    const pending = start(process.execPath, [helper, "save", "--", "a.md"], main, {
      ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_STASH_AFTER_PUSH_READY: ready, MDPRO_STASH_AFTER_PUSH_GATE: gate,
    });
    await waitFor(ready);
    const afterOwnPush = await oids(main);
    await git(linked, "stash", "push", "-q", "-m", "foreign", "--", "b.md");
    const beforeLookup = await oids(main);
    fs.unlinkSync(gate);
    const result = await pending.done;
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(afterOwnPush[0]);
    expect(await oids(main)).toEqual(beforeLookup);
  });

  it("refuses a duplicate marker from a foreign linked worktree", async () => {
    const { root, main, linked } = await makeRepo();
    fs.writeFileSync(path.join(main, "a.md"), "landing\n");
    fs.writeFileSync(path.join(linked, "b.md"), "foreign\n");
    const ready = path.join(root, "duplicate-ready"), gate = path.join(root, "duplicate-gate");
    fs.writeFileSync(gate, "hold\n");
    const pending = start(process.execPath, [helper, "save", "--", "a.md"], main, {
      ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_STASH_AFTER_PUSH_READY: ready, MDPRO_STASH_AFTER_PUSH_GATE: gate,
    });
    await waitFor(ready);
    const subject = await git(main, "stash", "list", "--format=%gs");
    const marker = subject.match(/mdpro-land-[0-9a-f-]{36}/)?.[0];
    expect(marker).toMatch(/^mdpro-land-[0-9a-f-]{36}$/);
    await git(linked, "stash", "push", "-q", "-m", marker!, "--", "b.md");
    const beforeLookup = await oids(main);
    fs.unlinkSync(gate);
    const result = await pending.done;
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/ambiguous/i);
    expect(await oids(main)).toEqual(beforeLookup);
  });

  it("applies the exact OID when a foreign push lands after apply's lookup", async () => {
    const { root, main, linked } = await makeRepo();
    fs.writeFileSync(path.join(main, "a.md"), "landing\n");
    const saved = await invoke(main, ["save", "--", "a.md"]);
    expect(saved.code, saved.stderr).toBe(0);
    const landing = saved.stdout.trim();
    fs.writeFileSync(path.join(linked, "b.md"), "foreign\n");
    const ready = path.join(root, "apply-ready"), gate = path.join(root, "apply-gate");
    fs.writeFileSync(gate, "hold\n");
    const pending = start(process.execPath, [helper, "apply", landing], main, {
      ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_STASH_BEFORE_APPLY_READY: ready, MDPRO_STASH_BEFORE_APPLY_GATE: gate,
    });
    await waitFor(ready);
    const beforeForeign = await oids(main);
    await git(linked, "stash", "push", "-q", "-m", "foreign", "--", "b.md");
    const beforeApply = await oids(main);
    expect(beforeApply).toHaveLength(beforeForeign.length + 1);
    fs.unlinkSync(gate);
    const result = await pending.done;
    expect(result.code, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(main, "a.md"), "utf8")).toBe("landing\n");
    expect(fs.readFileSync(path.join(main, "b.md"), "utf8")).toBe("base-b\n");
    expect(await oids(main)).toEqual(beforeApply);
  });

  it("fails no-op and failed pushes without adopting an older stash", async () => {
    const { main } = await makeRepo();
    fs.writeFileSync(path.join(main, "a.md"), "older\n");
    await git(main, "stash", "push", "-q", "-m", "old", "--", "a.md");
    const before = await oids(main);
    const noop = await invoke(main, ["save", "--", "a.md"]);
    expect(noop.code).not.toBe(0);
    expect(noop.stdout).toBe("");
    expect(await oids(main)).toEqual(before);
    const failed = await invoke(main, ["save", "--", "does-not-exist.md"]);
    expect(failed.code).not.toBe(0);
    expect(failed.stdout).toBe("");
    expect(await oids(main)).toEqual(before);
  });

  it("fails missing OIDs and conflicting apply without changing any stash entry", async () => {
    const { main } = await makeRepo();
    fs.writeFileSync(path.join(main, "a.md"), "landing\n");
    const saved = await invoke(main, ["save", "--", "a.md"]);
    expect(saved.code, saved.stderr).toBe(0);
    const oid = saved.stdout.trim();
    const before = await oids(main);
    for (const absent of ["f".repeat(40), "invalid"]) {
      const failed = await invoke(main, ["apply", absent]);
      expect(failed.code).not.toBe(0);
      expect(failed.stdout).toBe("");
      expect(await oids(main)).toEqual(before);
    }
    fs.writeFileSync(path.join(main, "a.md"), "conflict\n");
    const failed = await invoke(main, ["apply", oid]);
    expect(failed.code).not.toBe(0);
    expect(fs.readFileSync(path.join(main, "a.md"), "utf8")).toBe("conflict\n");
    expect(await oids(main)).toEqual(before);
  });

  it("runs the documented repo-relative helper command from the repo root", async () => {
    const command = fs.readFileSync(checklist, "utf8").match(/node (\.agents\/skills\/mdpro-delegator\/scripts\/landing-stash\.mjs) save --/);
    expect(command?.[1]).toBe(".agents/skills/mdpro-delegator/scripts/landing-stash.mjs");
    const result = await run(process.execPath, [command![1], "invalid"], process.cwd());
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("usage: landing-stash.mjs");
  });
});
