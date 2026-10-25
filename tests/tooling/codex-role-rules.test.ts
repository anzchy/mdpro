// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const shared = path.join(root, ".codex/rules/mdpro.rules");
const source = () => readFileSync(shared, "utf8");
const codex = spawnSync("codex", ["--version"], { encoding: "utf8" });
const hasCodex = !codex.error && codex.status === 0;
const codexAbsentReason = "codex CLI absent: execpolicy checks run on a provisioned host";
const checked = hasCodex ? it : it.skip;

function activeRules(content: string) {
  const uncommented = content.split("\n").filter(line => !/^\s*#/.test(line)).join("\n");
  return [...uncommented.matchAll(/prefix_rule\(\s*([\s\S]*?)^\)/gm)].map(([, body]) => ({
    pattern: body.match(/^\s*pattern\s*=\s*(.+),\s*$/m)?.[1],
    decision: body.match(/^\s*decision\s*=\s*"([^"]+)"/m)?.[1],
  }));
}

function assertSharedContract(content: string) {
  const rules = activeRules(content);
  for (const pattern of [
    '["rm", ["-rf", "-fr", "-r", "-R", "--recursive", "-Rf", "-fR"]]',
    '["git", "push"]', '["git", "reset", "--hard"]',
    '["git", ["checkout", "restore"], "."]',
    '["git", "clean", ["-f", "-fd", "-df", "-fdx", "-xdf", "-fx", "-xf", "-ffdx"]]',
    '["git", "branch", ["-D", "--delete", "-d"]]', '["git", "worktree", "remove"]',
    '["git", "add", ["-A", "--all", ".", "-u", "--update"]]',
    '["git", "commit", ["-a", "-am", "--all"]]',
    '["git", ["checkout", "switch"], ["master", "frontend-backend-redesign"]]',
    '["gh", "release"]', '["gh", "pr", "merge"]',
  ]) expect(rules).toContainEqual({ pattern, decision: "forbidden" });
  expect(rules.filter(rule => rule.pattern?.startsWith('["gh", "pr", [') ||
    rule.pattern?.startsWith('["gh", "workflow"'))).toEqual([]);
  expect(rules.filter(rule => rule.decision === "forbidden" &&
    /^\["gh", "pr", "(?:create|close)"\]$/.test(rule.pattern ?? ""))).toEqual([]);
}

function decision(argv: string[], role?: string) {
  const args = ["execpolicy", "check", "--rules", shared];
  if (role) args.push("--rules", path.join(root, "scripts/codex-rules", role));
  const result = spawnSync("codex", [...args, "--", ...argv], { cwd: root, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout).decision as string | undefined;
}

const forbidden = [
  ["git", "push", "origin", "x"],
  ["git", "push", "origin", "--force", "master"],
  ["git", "push", "--force-with-lease=a:b", "origin", "a"],
  ["git", "push", "origin", "+HEAD:x"],
  ["git", "push", "origin", "--mirror"],
  ["git", "push", "--force", "origin", "master"],
  ["gh", "pr", "merge", "1"],
  ["gh", "release", "create", "v1"],
  ["rm", "-rf", "src"],
  ["git", "reset", "--hard"],
];

describe("shared Codex command policy", () => {
  it("statically retains all shared guards and frees role actions", () => {
    const rules = source();
    assertSharedContract(rules);
    for (const fragment of [
      'pattern = ["git", "push"]', 'pattern = ["gh", "pr", "merge"]',
      'pattern = ["gh", "release"]', 'pattern = ["git", "reset", "--hard"]',
      'pattern = ["git", "worktree", "remove"]', 'pattern = ["git", "branch",',
      'pattern = ["git", "add",', 'pattern = ["git", "commit",',
      'pattern = ["git", ["checkout", "switch"],',
    ]) expect(rules).toContain(fragment);
    expect(rules).not.toMatch(/pattern\s*=\s*\["gh",\s*"pr",\s*\[.*(?:create|close)/);
    expect(rules).not.toMatch(/pattern\s*=\s*\["gh",\s*\["release",\s*"workflow"\]/);
  });
  it("rejects changed, deleted and commented-out prohibitions", () => {
    const original = source();
    const block = /prefix_rule\(\s*pattern = \["git", "push"\],[\s\S]*?^\)/m;
    const match = original.match(block)?.[0];
    expect(match).toBeDefined();
    expect(() => assertSharedContract(original.replace(match!, match!.replace('decision = "forbidden"', 'decision = "allow"')))).toThrow();
    expect(() => assertSharedContract(original.replace(match!, ""))).toThrow();
    expect(() => assertSharedContract(original.replace(match!, match!.split("\n").map(line => `# ${line}`).join("\n")))).toThrow();
  });
  it("rejects standalone forbidden PR creation and closure in the shared file", () => {
    for (const action of ["create", "close"]) {
      const added = `${source()}\nprefix_rule(\n    pattern = ["gh", "pr", "${action}"],\n    decision = "forbidden",\n)\n`;
      expect(() => assertSharedContract(added)).toThrow();
    }
  });
  for (const argv of forbidden) checked(`forbids ${argv.join(" ")}${hasCodex ? "" : ` (${codexAbsentReason})`}`, () => {
    expect(decision(argv)).toBe("forbidden");
  });
  for (const argv of [["gh", "pr", "create"], ["gh", "pr", "view", "1"], ["gh", "workflow", "run", "release.yml"]]) {
    checked(`does not forbid ${argv.join(" ")}${hasCodex ? "" : ` (${codexAbsentReason})`}`, () => expect(decision(argv)).not.toBe("forbidden"));
  }
});
