// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const installer = path.join(root, "scripts/codex-rules/install-role.mjs");
const restricted = path.join(root, "scripts/codex-rules/restricted-role.rules");
const common = path.join(root, ".codex/rules/mdpro.rules");
const hasCodex = spawnSync("codex", ["--version"], { encoding: "utf8" }).status === 0;
const checked = hasCodex ? it : it.skip;
const skipReason = "codex CLI absent: composition requires execpolicy";
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function roleRules(role: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr141-composition-"));
  made.push(dir);
  spawnSync("git", ["init", "-q", dir]);
  fs.mkdirSync(path.join(dir, ".codex/rules"), { recursive: true });
  fs.copyFileSync(common, path.join(dir, ".codex/rules/mdpro.rules"));
  const r = spawnSync(process.execPath, [installer, "--worktree", dir, "--role", role], {
    encoding: "utf8", env: { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_GUARD_TEST_MAIN: dir },
  });
  expect(r.status, r.stderr).toBe(0);
  return path.join(dir, ".codex/rules/mdpro-role.rules");
}
function decision(overlay: string, argv: string[]) {
  const r = spawnSync("codex", ["execpolicy", "check", "--rules", common, "--rules", overlay, "--", ...argv], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout).decision;
}

function activeRules(content: string) {
  const uncommented = content.split("\n").filter(line => !/^\s*#/.test(line)).join("\n");
  return [...uncommented.matchAll(/prefix_rule\(\s*([\s\S]*?)^\)/gm)].map(([, body]) => ({
    pattern: body.match(/^\s*pattern\s*=\s*(.+),\s*$/m)?.[1],
    decision: body.match(/^\s*decision\s*=\s*"([^"]+)"/m)?.[1],
  }));
}
function assertRestrictedContract(content: string) {
  const rules = activeRules(content);
  expect(rules).toContainEqual({ pattern: '["gh", "pr", ["create", "merge", "close"]]', decision: "forbidden" });
  expect(rules).toContainEqual({ pattern: '["gh", "workflow"]', decision: "forbidden" });
  for (const name of ["install-role", "push-guard", "land-guard"]) {
    for (const script of [`scripts/codex-rules/${name}.mjs`, `/Users/jack/Documents/mac-app/mdpro/scripts/codex-rules/${name}.mjs`]) {
      expect(rules.some(rule => rule.decision === "forbidden" && rule.pattern?.includes(`"${script}"`))).toBe(true);
    }
    expect(rules).toContainEqual({ pattern: `["scripts/codex-rules/${name}.mjs"]`, decision: "forbidden" });
    expect(rules).toContainEqual({ pattern: `["/Users/jack/Documents/mac-app/mdpro/scripts/codex-rules/${name}.mjs"]`, decision: "forbidden" });
  }
  expect(rules.some(rule => rule.decision === "forbidden" && rule.pattern?.startsWith('["node", [') &&
    ["install-role", "push-guard", "land-guard"].every(name =>
      rule.pattern?.includes(`"scripts/codex-rules/${name}.mjs"`) &&
      rule.pattern?.includes(`"/Users/jack/Documents/mac-app/mdpro/scripts/codex-rules/${name}.mjs"`)))).toBe(true);
}

it("static restricted policy covers decisions and every guarded script entry", () => {
  assertRestrictedContract(fs.readFileSync(restricted, "utf8"));
});

it("rejects changed, deleted and commented restricted prohibitions", () => {
  const source = fs.readFileSync(restricted, "utf8");
  const block = source.match(/prefix_rule\(\s*pattern = \["gh", "workflow"\],[\s\S]*?^\)/m)?.[0];
  expect(block).toBeDefined();
  expect(() => assertRestrictedContract(source.replace(block!, block!.replace('decision = "forbidden"', 'decision = "allow"')))).toThrow();
  expect(() => assertRestrictedContract(source.replace(block!, ""))).toThrow();
  expect(() => assertRestrictedContract(source.replace(block!, block!.split("\n").map(line => `# ${line}`).join("\n")))).toThrow();
});

it("rejects each missing absolute Node script entry while bare entries remain", () => {
  const source = fs.readFileSync(restricted, "utf8");
  for (const name of ["install-role", "push-guard", "land-guard"]) {
    const absolute = `"/Users/jack/Documents/mac-app/mdpro/scripts/codex-rules/${name}.mjs"`;
    const nodeBlock = source.match(/prefix_rule\(\s*pattern = \["node", \[[^\n]+\]\],[\s\S]*?^\)/m)?.[0];
    expect(nodeBlock).toContain(absolute);
    expect(() => assertRestrictedContract(source.replace(nodeBlock!, nodeBlock!.replace(`, ${absolute}`, "")))).toThrow();
  }
});

for (const role of ["implementor", "auditor", "delegator"]) checked(`${role} composes with the shared policy${hasCodex ? "" : ` (${skipReason})`}`, () => {
  const overlay = roleRules(role);
  const restrictedRole = role !== "delegator";
  for (const argv of [
    ["git", "push", "origin", "x"], ["git", "push", "origin", "--force", "master"],
    ["git", "push", "--force-with-lease=a:b", "origin", "a"],
    ["git", "push", "origin", "+HEAD:x"], ["git", "push", "origin", "--mirror"],
    ["gh", "pr", "merge", "1"], ["gh", "release", "create", "v1"],
    ["rm", "-rf", "src"], ["git", "reset", "--hard"],
  ]) expect(decision(overlay, argv)).toBe("forbidden");
  for (const action of ["create", "close"]) expect(decision(overlay, ["gh", "pr", action])).toBe(restrictedRole ? "forbidden" : undefined);
  expect(decision(overlay, ["gh", "workflow", "run", "release.yml"])).toBe(restrictedRole ? "forbidden" : "prompt");
  if (restrictedRole) for (const name of ["install-role", "push-guard", "land-guard"]) {
    for (const script of [`scripts/codex-rules/${name}.mjs`, `/Users/jack/Documents/mac-app/mdpro/scripts/codex-rules/${name}.mjs`]) {
      expect(decision(overlay, ["node", script, "--help"])).toBe("forbidden");
      expect(decision(overlay, [script, "--help"])).toBe("forbidden");
    }
  }
});
