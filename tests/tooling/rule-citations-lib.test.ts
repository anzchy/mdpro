// @vitest-environment node
// D355 (ADR-0147 d4): self-tests of the citation half of the checker. Fixture trees only; the live tree is asserted
// in rule-citations.test.ts. The budget half's self-tests are in rules-budget-lib.test.ts.
import { afterAll, describe, expect, it } from "vitest";
import {
  findCitations, loadMap, resolveCitation, scanCitations, SECTION_MAP, validateMap, type Citation,
} from "./rules-budget-lib";
import { cleanupFixtures, fixture, R70, R71, update } from "./rules-budget-fixture";

afterAll(cleanupFixtures);

const rules = (r70: string, r71: string) => ({ [R70]: r70, [R71]: r71 });
const map = (rows: { cite: string; targets: string[] }[]) => ({ [SECTION_MAP]: JSON.stringify({ rows }) });
const unresolved = (root: string) => scanCitations(root).unresolved;
const cite = (text: string, file = "docs/x.md"): Citation[] => findCitations(file, text);

describe("rule citations (fixtures)", () => {
  const base = rules(
    "# 70\n\n## Sessions\n\n## Commits and branches\n\n### When a session is idle: pull from its queue\n\n## Device a\n\n## Device b\n",
    "# 71\n\n## Slots\n\n## Briefs and self-acceptance\n\n## Delegator runtime route\n",
  );

  it("R3/R4/R11: exact heading, heading followed by prose, punctuation slug", async () => {
    const root = await fixture({
      ...base,
      "docs/a.md": "See rule 71 § Slots. And rule 71 § Briefs and self-acceptance confirms only the table.\n" +
        "Link [r](../.claude/rules/71-herdr-mixed-roster.md#delegator-runtime-route) and rule 70 § \"When a session is idle\".\n" +
        "[x](../.claude/rules/70-multi-session-coordination.md#when-a-session-is-idle-pull-from-its-queue)\n",
    });
    expect(unresolved(root)).toEqual([]);
    expect(scanCitations(root).count).toBe(5);
  });

  it("R11: a wrong anchor is unresolved", async () => {
    const root = await fixture({ ...base, "docs/a.md": "[r](../.claude/rules/71-herdr-mixed-roster.md#delegator-runtime-routes)\n" });
    expect(unresolved(root).map((u) => u.where)).toEqual(["docs/a.md:1"]);
  });

  it("R6/R7: ambiguous prefix and missing label are unresolved, with file:line", async () => {
    const root = await fixture({ ...base, "docs/a.md": "x\nrule 70 § Device stuff\nrule 70 § Nonexistent\n" });
    const u = unresolved(root);
    expect(u.map((x) => x.where)).toEqual(["docs/a.md:2", "docs/a.md:3"]);
    expect(u[0].reason).toMatch(/ambiguous.*Device a \| Device b/);
    expect(u[1].reason).toMatch(/Nonexistent/);
  });

  it("R8/R20: a CJK label resolves only through its map row, and a dead row target fails", async () => {
    const withRow = await fixture({
      ...base, ...map([{ cite: "rule 70 § 会话轮换", targets: [`${R70}#sessions`] }]), "docs/a.md": "见 rule 70 § 会话轮换。\n",
    });
    expect(unresolved(withRow)).toEqual([]);
    const without = await fixture({ ...base, "docs/a.md": "见 rule 70 § 会话轮换。\n" });
    expect(unresolved(without)).toHaveLength(1);
    const dead = await fixture({
      ...base, ...map([{ cite: "rule 70 § Sessions", targets: [`${R70}#gone`] }]), "docs/a.md": "rule 70 § Sessions\n",
    });
    expect(unresolved(dead)[0].reason).toMatch(/dead target/);
  });

  it("R9/R10/R21: multi-target rows need every target; the map validates rows nobody cites", async () => {
    const root = await fixture({
      ...base, "docs/agents/auditor.md": "# A\n\n## Downgrades\n",
      ...map([
        { cite: "rule 70 item 4", targets: [`${R70}#commits-and-branches`, "docs/agents/auditor.md#downgrades"] },
        { cite: "rule 70 item 5", targets: [] },
        { cite: "rule 71 § Restart", targets: ["docs/agents/nope.md#x"] },
      ]),
      "docs/a.md": "rule 70 item 4\n",
    });
    expect(unresolved(root)).toEqual([]);
    const problems = validateMap(root, loadMap(root));
    expect(problems.some((p) => /item 5" has no targets/.test(p))).toBe(true);
    expect(problems.some((p) => /Restart" target docs\/agents\/nope.md#x: file missing/.test(p))).toBe(true);
    update(root, "docs/agents/auditor.md", "# A\n\n## Downgrade\n");
    expect(unresolved(root)[0].reason).toMatch(/auditor.md#downgrades/);
  });

  it("R5/R19/R27: item rows are keyed by rule; `<label> item <n>` needs both; item lists check every item", async () => {
    const root = await fixture({
      ...base, ...map([{ cite: "rule 70 item 4", targets: [`${R70}#commits-and-branches`] }]),
      "docs/a.md": [
        "rule 70 § Commits item 4", "rule 70 Commits item 4", "rule 71 item 4", "rule 70 item 9",
        "rule 70 Bogus item 4", "rule 70 items 4 and 9", "rule 70 item 4, 9", "",
      ].join("\n"),
    });
    const u = unresolved(root);
    expect(u.map((x) => x.where)).toEqual(["docs/a.md:3", "docs/a.md:4", "docs/a.md:5", "docs/a.md:6", "docs/a.md:7"]);
    expect(u.find((x) => x.where === "docs/a.md:5")!.reason).toMatch(/Bogus/);
    expect(u.find((x) => x.where === "docs/a.md:6")!.reason).toMatch(/item 9/);
    expect(u.find((x) => x.where === "docs/a.md:7")!.reason).toMatch(/item 9/);
  });

  it("R15: grammar variants; rule 700 and rule 7 are not citations", () => {
    const found = cite("Rule 70's § Sessions; rule 70 § Sessions; rule 700 § X; rule 7 § X; rules 70 and 71\n");
    expect(found).toHaveLength(2);
    expect(found.every((c) => c.label === "Sessions")).toBe(true);
    expect(cite("rule 70 says item 4 is fine\n")).toEqual([]); // prose, not `<Label> item <n>`
  });

  it("R18: a heading of rule 71 does not resolve a rule 70 citation", async () => {
    const root = await fixture({ ...base, "docs/a.md": "rule 70 § Slots\nrule 71 § Slots\n" });
    expect(unresolved(root).map((u) => u.where)).toEqual(["docs/a.md:1"]);
  });

  it("R22: links resolve from the citing file's directory", async () => {
    const root = await fixture({
      ...base, "docs/agents/auditor.md": "# A\n\n## Downgrades\n",
      "docs/agents/b.md": "`../../docs/agents/auditor.md#downgrades` [ok](../../.claude/rules/71-herdr-mixed-roster.md#slots) [bad](.claude/rules/71-herdr-mixed-roster.md#slots)\n",
      "CLAUDE.md": "`docs/agents/auditor.md#downgrades` `docs/agents/auditor.md#nope`\n",
    });
    // b.md: the third link resolves to docs/agents/.claude/... which does not exist; CLAUDE.md: the second pointer is dead
    expect(unresolved(root).map((u) => u.where).sort()).toEqual(["CLAUDE.md:1", "docs/agents/b.md:1"]);
  });

  it("R23: citations wrapped across a line break are found at their first line", async () => {
    const root = await fixture({ ...base, "docs/a.md": "intro rule 70\n§ Nonexistent here\nand rule 70\n§ Sessions\n" });
    expect(unresolved(root).map((u) => u.where)).toEqual(["docs/a.md:1"]);
  });

  it("R24/R14: CJK paths come back unquoted; untracked files are not scanned", async () => {
    const root = await fixture({ ...base, "docs/架构.md": "rule 70 § Nonexistent\n" }, { "docs/untracked.md": "rule 70 § Nope\n" });
    expect(unresolved(root).map((u) => u.where)).toEqual(["docs/架构.md:1"]);
  });

  it("R13: hooks and agents are scanned", async () => {
    const root = await fixture({ ...base, ".claude/hooks/x.sh": "# rule 70 § Nope\n", ".claude/agents/a.md": "rule 71 § Nope\n" });
    expect(unresolved(root).map((u) => u.where).sort()).toEqual([".claude/agents/a.md:1", ".claude/hooks/x.sh:1"]);
  });

  it("R16: renaming a heading breaks a citation that resolved before", async () => {
    const root = await fixture({ ...base, "docs/a.md": "rule 71 § Slots\n" });
    expect(unresolved(root)).toEqual([]);
    update(root, R71, "# 71\n\n## Places\n");
    expect(unresolved(root)).toHaveLength(1);
  });

  it("R12/R26: Governing-text and binding pointers resolve; a renamed target fails", async () => {
    const root = await fixture({
      ...base, "docs/agents/auditor.md": "# A\n\n## Downgrades\n",
      ".agents/skills/mdpro-delegator/SKILL.md": "Apply `references/l.md#landing`.\n",
      ".agents/skills/mdpro-delegator/references/l.md": "# L\n\n## Landing\n",
      [R70]: "# 70\n\n## Sessions\n\nGoverning text: `docs/agents/auditor.md#downgrades`\n",
    });
    expect(unresolved(root)).toEqual([]);
    update(root, ".agents/skills/mdpro-delegator/references/l.md", "# L\n\n## Land\n");
    expect(unresolved(root).map((u) => u.where)).toEqual([".agents/skills/mdpro-delegator/SKILL.md:1"]);
  });

  it("resolveCitation reports an empty label", async () => {
    const root = await fixture(base);
    expect(resolveCitation(root, { file: "x", line: 1, rule: "70", kind: "label", label: "", raw: "" }, []).ok).toBe(false);
  });
});
