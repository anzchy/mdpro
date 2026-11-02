// @vitest-environment node
/**
 * RC5 (AC-7, the docs switch): the instructions that tell a session where receipts live name the
 * per-id item files and keep-check, never the legacy store, except on a line that says it is the
 * legacy note. `docs/specs/**` is exempt: its snapshots are immutable (ruling 1, gpt M4 / opus M2).
 * Matrix row: A7a.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const VERIFIER = ".claude/agents/mdpro-landing-verifier.md";
const NAMED = [
  VERIFIER,
  ".claude/rules/10-tdd.md",
  ".claude/rules/70-multi-session-coordination.md",
  "docs/guide/receipt-evidence.md",
  ".agents/skills/mdpro-delegator/references/guide.md",
  ".agents/skills/mdpro-delegator/references/templates/brief-template.md",
  ".agents/skills/mdpro-delegator/references/templates/fix-brief-template.md",
  ".codex/agents/mdpro-tdd-reviewer.toml",
];
const SKILL = ".agents/skills/jack-tdd-workflow";
const LEGACY = /tdd-guardian\/receipts\.json|evidence\.json/;
const read = (file: string) => readFileSync(join(repoRoot, file), "utf8");
function walk(dir: string): string[] {
  return readdirSync(join(repoRoot, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(repoRoot, path)).isDirectory() ? walk(path) : [relative(repoRoot, join(repoRoot, path))];
  });
}

describe("RC5 the docs name the item files (A7a)", () => {
  it("A7a: no live instruction names the legacy store outside a line marked as the legacy note", () => {
    const files = [...NAMED, ...walk(SKILL)];
    expect(files.filter((file) => file.startsWith("docs/specs/"))).toEqual([]);
    const live = files.flatMap((file) => read(file).split("\n")
      .map((line, index) => ({ file, line: index + 1, text: line }))
      .filter(({ text }) => LEGACY.test(text) && !/legacy/i.test(text)));
    expect(live).toEqual([]);
  });

  it("A7a: the verifier's step 4 runs keep-check on the parent and the head, and a non-zero exit is ISSUES", () => {
    const text = read(VERIFIER);
    const step = text.slice(text.indexOf("\n4. "), text.indexOf("\n5. "));
    expect(step).toContain("node scripts/tdd/receipt-store.mjs keep-check --parent <parent> --head <SHA>");
    expect(step).toMatch(/non-zero exit is ISSUES/);
    expect(step).toContain(".claude/tdd-guardian/receipts/<ID>.json");
  });
});
