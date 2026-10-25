// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts/codex-rules/install-role.mjs");
const made: string[] = [];
function child(file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ status: number; stdout: string; stderr: string }>(resolve => {
    execFile(file, args, { encoding: "utf8", ...options }, (error, stdout, stderr) => {
      resolve({ status: error ? 1 : 0, stdout, stderr });
    });
  });
}
const git = async (dir: string, ...args: string[]) => {
  const r = await child("git", args, { cwd: dir });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
};
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr141-role-"));
  made.push(dir);
  await git(dir, "init", "-q");
  fs.mkdirSync(path.join(dir, ".codex/rules"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".codex/rules/mdpro.rules"), "# shared\n");
  await git(dir, "add", ".codex/rules/mdpro.rules");
  await git(dir, "-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "base");
  return { dir, overlay: path.join(dir, ".codex/rules/mdpro-role.rules") };
}
function install(dir: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return child(process.execPath, [script, "--worktree", dir, ...args], {
    cwd: root, env: { ...process.env, ...env },
  });
}
const testEnv = (main: string) => ({ MDPRO_GUARD_TEST: "1", MDPRO_GUARD_TEST_MAIN: main });
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("installs each role atomically and default implementor idempotently", async () => {
  const f = (await fixture());
  for (const [args, role] of [[[], "implementor"], [["--role", "auditor"], "auditor"], [["--role", "delegator"], "delegator"]] as const) {
    const r = (await install(f.dir, [...args], testEnv(f.dir)));
    expect(r.status, r.stderr).toBe(0);
    const content = fs.readFileSync(f.overlay, "utf8");
    expect(content.startsWith(`# Local mdpro role: ${role}\n`)).toBe(true);
    if (role === "delegator") expect(content).toContain('decision = "prompt"');
    else expect(content).toContain('pattern = ["gh", "pr",');
    expect((await install(f.dir, [...args], testEnv(f.dir))).status).toBe(0);
    expect(fs.readFileSync(f.overlay, "utf8")).toBe(content);
    expect(fs.readdirSync(path.dirname(f.overlay)).filter(x => x.startsWith(".role-"))).toEqual([]);
  }
});

it("refuses bad inputs without changing an existing overlay", async () => {
  const f = (await fixture());
  fs.writeFileSync(f.overlay, "sentinel\n");
  const missing = path.join(f.dir, "missing");
  for (const [dir, args] of [
    [f.dir, ["--role", "unknown"]], ["relative/path", []], [missing, []],
  ] as [string, string[]][]) {
    expect((await install(dir, args)).status).not.toBe(0);
    expect(fs.readFileSync(f.overlay, "utf8")).toBe("sentinel\n");
  }
  fs.renameSync(path.join(f.dir, ".codex/rules/mdpro.rules"), path.join(f.dir, "shared-away"));
  expect((await install(f.dir)).status).not.toBe(0);
  expect(fs.readFileSync(f.overlay, "utf8")).toBe("sentinel\n");
});

it("refuses a symlink target without touching its referent", async () => {
  const f = (await fixture());
  const referent = path.join(f.dir, "referent");
  fs.writeFileSync(referent, "sentinel\n");
  fs.symlinkSync(referent, f.overlay);
  expect((await install(f.dir)).status).not.toBe(0);
  expect(fs.readFileSync(referent, "utf8")).toBe("sentinel\n");
  expect(fs.lstatSync(f.overlay).isSymbolicLink()).toBe(true);
});

it("preserves the old overlay and removes temp files when final rename fails", async () => {
  const f = (await fixture());
  fs.writeFileSync(f.overlay, "sentinel\n");
  const preload = path.join(f.dir, "fail-rename.cjs");
  fs.writeFileSync(preload, `const fs = require("node:fs");
const original = fs.renameSync;
fs.renameSync = function(from, to) {
  if (String(from).includes(".role-") && String(to).endsWith("mdpro-role.rules")) {
    const error = new Error("injected final rename failure");
    error.code = "EACCES";
    throw error;
  }
  return original.apply(this, arguments);
};
`);
  const r = (await install(f.dir, ["--role", "auditor"], { NODE_OPTIONS: `--require=${preload}` }));
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("injected final rename failure");
  expect(fs.readFileSync(f.overlay, "utf8")).toBe("sentinel\n");
  expect(fs.readdirSync(path.dirname(f.overlay)).filter(name => name.startsWith(".role-"))).toEqual([]);
});

it("executes an absolute copy of the installer in a temporary worktree", async () => {
  const f = (await fixture());
  const copiedDir = path.join(f.dir, "scripts/codex-rules");
  fs.mkdirSync(copiedDir, { recursive: true });
  const copied = path.join(copiedDir, "install-role.mjs");
  fs.copyFileSync(script, copied);
  fs.copyFileSync(path.join(root, "scripts/codex-rules/restricted-role.rules"), path.join(copiedDir, "restricted-role.rules"));
  const result = await child(process.execPath, [copied, "--worktree", f.dir]);
  expect(result.status, result.stderr).toBe(0);
  expect(fs.readFileSync(f.overlay, "utf8")).toContain("# Local mdpro role: implementor\n");
});

it("restricts delegator to the configured main tree, not a linked tree", async () => {
  const f = (await fixture());
  const linked = path.join(f.dir, "linked");
  (await git(f.dir, "worktree", "add", "-qb", "topic", linked));
  const linkedOverlay = path.join(linked, ".codex/rules/mdpro-role.rules");
  fs.writeFileSync(linkedOverlay, "sentinel\n");
  expect((await install(linked, ["--role", "delegator"], testEnv(linked))).status).not.toBe(0);
  expect(fs.readFileSync(linkedOverlay, "utf8")).toBe("sentinel\n");
  fs.writeFileSync(f.overlay, "sentinel\n");
  const other = (await fixture());
  expect((await install(f.dir, ["--role", "delegator"], testEnv(other.dir))).status).not.toBe(0);
  expect(fs.readFileSync(f.overlay, "utf8")).toBe("sentinel\n");
});

it("ignores disabled test overrides and refuses overrides escaping tmpdir", async () => {
  const f = (await fixture());
  fs.writeFileSync(f.overlay, "sentinel\n");
  for (const env of [
    { MDPRO_GUARD_TEST_MAIN: f.dir },
    { MDPRO_GUARD_TEST: "0", MDPRO_GUARD_TEST_MAIN: f.dir },
    { MDPRO_GUARD_TEST: "1", MDPRO_GUARD_TEST_MAIN: root },
  ]) {
    expect((await install(f.dir, ["--role", "delegator"], env)).status).not.toBe(0);
    expect(fs.readFileSync(f.overlay, "utf8")).toBe("sentinel\n");
  }
  const escape = path.join(f.dir, "outside-link");
  fs.symlinkSync(root, escape);
  expect((await install(f.dir, ["--role", "delegator"], testEnv(escape))).status).not.toBe(0);
  expect(fs.readFileSync(f.overlay, "utf8")).toBe("sentinel\n");
});
