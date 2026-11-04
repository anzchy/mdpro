// @vitest-environment node
// GH628-S1: a receipt verdict is evidence; the parent-record integrity check stays a landing gate.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const entryPath = "docs/agents/decisions/20261104-receipts-are-audit-evidence.md";
const entry = () => existsSync(resolve(root, entryPath)) ? read(entryPath) : "";

const livePaths = [
  ".claude/agents/mdpro-landing-verifier.md",
  ".agents/skills/mdpro-delegator/SKILL.md",
  ".agents/skills/mdpro-delegator/references/guide.md",
  ".agents/skills/mdpro-delegator/references/landing-and-audit.md",
  ".agents/skills/mdpro-delegator/references/roster-and-routing.md",
  ".agents/skills/mdpro-delegator/references/templates/brief-template.md",
  ".agents/skills/mdpro-delegator/references/templates/landing-docs-checklist.md",
  ".agents/skills/mdpro-delegator/references/templates/audit-request-template.md",
  ".agents/skills/mdpro-delegator/references/templates/merged-verdict-template.md",
  ".claude/rules/10-tdd.md",
  "docs/guide/receipt-evidence.md",
  ".codex/skills/mdpro-tdd-workflow/SKILL.md",
  ".codex/skills/mdpro-tdd-workflow/references/review.md",
  ".codex/agents/mdpro-tdd-reviewer.toml",
];

describe("GH628-S1 receipt verdict cutover", () => {
  it("keeps parent bytes and shape as a PASS check while focused verdicts are information", () => {
    const verifier = read(livePaths[0]);
    const pass = verifier.slice(verifier.indexOf("PASS requires all of:"));
    expect(verifier).toContain("receipt-store.mjs keep-check --parent <parent> --head <SHA>");
    expect(verifier).toContain("A non-zero exit is ISSUES");
    expect(verifier).toMatch(/info: FOCUSED-RECEIPTS/);
    expect(pass).toContain("receipts ok");
    expect(pass).not.toContain("focused receipts ok");
    expect(verifier).not.toMatch(/^REPLAYS\s/m);
    expect(verifier).not.toContain("--expect-digest");
    expect(verifier).not.toMatch(/For every receipt the branch added that it names, run/);
  });

  it("gives the Claude and Codex routes the same post-master boundary", () => {
    const decision = entry();
    expect(decision).toContain("verifiers dispatched after this commit is on master");
    expect(decision).toMatch(/GH592, GH607 and D354 wait[^.]*re-verif/i);
    for (const path of [livePaths[0], livePaths[2], livePaths[3]]) {
      expect(read(path), path).toContain("20261104-receipts-are-audit-evidence.md");
    }
  });

  it("has no live instruction that makes a receipt verdict, replay or exception decide landing", () => {
    const obsolete = /receipt exceptions? need|any receipt exception approved|every receipt exception|verifier re-runs the lanes and the receipts|refresh every replay digest|A receipt `SEPARATION-BROKEN` without a stated reason \| High|both auditors' non-weakening rulings[^\n]*clear the receipt/i;
    const found = livePaths.flatMap((path) => read(path).split("\n").flatMap((line, i) => obsolete.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : []));
    expect(found).toEqual([]);
  });
});
