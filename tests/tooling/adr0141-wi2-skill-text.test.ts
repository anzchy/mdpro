// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const skill = path.join(root, ".agents/skills/mdpro-delegator");
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");
const skillText = (name: string) => fs.readFileSync(path.join(skill, name), "utf8");

describe("ADR-0141 WI-2 published guard protocol", () => {
  it("retires the mutable push helper from every skill entry point", () => {
    expect(fs.existsSync(path.join(skill, "scripts/push-head.sh"))).toBe(false);
    for (const name of ["SKILL.md", "references/guide.md", "references/templates/landing-docs-checklist.md"]) {
      expect(skillText(name)).not.toContain("push-head.sh");
    }
    expect(fs.existsSync(path.join(skill, "references/templates/.claude"))).toBe(false);
  });

  it("publishes checked Codex push and land commands while preserving the Claude route", () => {
    const main = skillText("SKILL.md");
    const guide = skillText("references/guide.md");
    const landing = skillText("references/templates/landing-docs-checklist.md");
    for (const text of [main, guide, landing]) {
      expect(text).toContain("node scripts/codex-rules/push-guard.mjs");
      expect(text).toContain("node scripts/codex-rules/land-guard.mjs");
      expect(text).toContain("--docs-only");
      expect(text).toContain("git merge --ff-only");
      expect(text).toContain("git push origin master");
    }
    expect(guide).toMatch(/do not check.{0,80}verifier PASS.{0,80}audit verdict/s);
    expect(main).toContain("pending ruling as its final message");
    expect(guide).toContain("reset-codex.sh");
    expect(guide).toContain("between-window hand provisioning ends with WI-2 landing");
  });

  it("makes the shared and per-role Codex guard, evasion, and reset order explicit", () => {
    const agents = read("AGENTS.md");
    const rule = read(".claude/rules/71-herdr-mixed-roster.md");
    expect(agents).toContain(".codex/rules/mdpro-role.rules");
    expect(agents).toContain("gitignored");
    expect(agents).toContain("push-guard.mjs");
    expect(agents).toContain("land-guard.mjs");
    for (const evasion of ["git -C", "env", "./", "absolute", "node --", "wrappers", "gh api"]) {
      expect(agents).toContain(evasion);
    }
    expect(rule).toContain("install-role.mjs --role implementor|auditor");
    expect(rule).toContain("before `herdr agent start`");
    expect(rule).toContain("missing is not started");
  });

  it("requires both auditors and at most two rounds in committed skill text", () => {
    const main = skillText("SKILL.md");
    const guide = skillText("references/guide.md");
    const merged = skillText("references/templates/merged-verdict-template.md");
    const confirm = skillText("references/templates/confirm-request-template.md");
    for (const text of [main, guide, merged]) {
      expect(text).toContain("both auditors on every audit");
      expect(text).toContain("at most two rounds");
      expect(text).not.toMatch(/optional.{0,40}opus-auditor/i);
    }
    expect(confirm).not.toMatch(/k\s*=\s*3|last, ADR-0120/i);
    expect(confirm).toContain("both auditors");
    expect(confirm).toContain("at most two rounds");
    expect(guide).not.toContain("at most three rounds");
    expect(guide).not.toContain("then gpt-auditor confirms");
    expect(guide).toContain("then both auditors confirm");
    expect(merged).not.toContain("scoped confirm by gpt-auditor");
    expect(merged).toContain("scoped confirm by both auditors");
  });

  it("routes macOS device batches through the full-access device reset", () => {
    const main = skillText("SKILL.md");
    const guide = skillText("references/guide.md");
    const template = skillText("references/templates/device-brief-template.md");
    for (const text of [main, guide, template]) {
      expect(text).toMatch(/reset-codex\.sh gpt-auditor <(?:wt|worktree)> <model> <effort> device/);
    }
  });
});
