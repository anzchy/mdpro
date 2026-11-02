// @vitest-environment node
// D355 (ADR-0147 d4, d5): self-tests of the checker the two live gates use. Fixture trees only; the live tree is
// asserted in rule-citations.test.ts and always-on-budget.test.ts.
import { describe, expect, it } from "vitest";
import {
  claudeAlwaysOn, codexShared, findCitations, isPathScoped, readBlocks, readDirectiveViolations, resolveCitation,
  route, scanCitations, SECTION_MAP, validateMap, loadMap, type Citation,
} from "./rules-budget-lib";
import { fixture, pad, R70, R71, update } from "./rules-budget-fixture";

const rules = (r70: string, r71: string) => ({ [R70]: r70, [R71]: r71 });
const map = (rows: { cite: string; targets: string[] }[]) => ({ [SECTION_MAP]: JSON.stringify({ rows }) });
const unresolved = (root: string) => scanCitations(root).unresolved;
const cite = (text: string, file = "docs/x.md"): Citation[] => findCitations(file, text);

describe("rule citations (fixtures)", () => {
  const base = rules(
    "# 70\n\n## Sessions\n\n## Commits and branches\n\n### When a session is idle: pull from its queue\n\n## Device a\n\n## Device b\n",
    "# 71\n\n## Slots\n\n## Briefs and self-acceptance\n\n## Delegator runtime route\n",
  );

  it("R3/R4/R11: exact heading, heading followed by prose, punctuation slug", () => {
    const root = fixture({
      ...base,
      "docs/a.md": "See rule 71 § Slots. And rule 71 § Briefs and self-acceptance confirms only the table.\n" +
        "Link [r](../.claude/rules/71-herdr-mixed-roster.md#delegator-runtime-route) and rule 70 § \"When a session is idle\".\n" +
        "[x](../.claude/rules/70-multi-session-coordination.md#when-a-session-is-idle-pull-from-its-queue)\n",
    });
    expect(unresolved(root)).toEqual([]);
    expect(scanCitations(root).count).toBe(5);
  });

  it("R11: a wrong anchor is unresolved", () => {
    const root = fixture({ ...base, "docs/a.md": "[r](../.claude/rules/71-herdr-mixed-roster.md#delegator-runtime-routes)\n" });
    expect(unresolved(root).map((u) => u.where)).toEqual(["docs/a.md:1"]);
  });

  it("R6/R7: ambiguous prefix and missing label are unresolved, with file:line", () => {
    const root = fixture({ ...base, "docs/a.md": "x\nrule 70 § Device stuff\nrule 70 § Nonexistent\n" });
    const u = unresolved(root);
    expect(u.map((x) => x.where)).toEqual(["docs/a.md:2", "docs/a.md:3"]);
    expect(u[0].reason).toMatch(/ambiguous.*Device a \| Device b/);
    expect(u[1].reason).toMatch(/Nonexistent/);
  });

  it("R8/R20: a CJK label resolves only through its map row, and a dead row target fails", () => {
    const withRow = fixture({
      ...base, ...map([{ cite: "rule 70 § 会话轮换", targets: [`${R70}#sessions`] }]), "docs/a.md": "见 rule 70 § 会话轮换。\n",
    });
    expect(unresolved(withRow)).toEqual([]);
    const without = fixture({ ...base, "docs/a.md": "见 rule 70 § 会话轮换。\n" });
    expect(unresolved(without)).toHaveLength(1);
    const dead = fixture({
      ...base, ...map([{ cite: "rule 70 § Sessions", targets: [`${R70}#gone`] }]), "docs/a.md": "rule 70 § Sessions\n",
    });
    expect(unresolved(dead)[0].reason).toMatch(/dead target/);
  });

  it("R9/R10/R21: multi-target rows need every target; the map validates rows nobody cites", () => {
    const root = fixture({
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

  it("R5/R19/R27: item rows are keyed by rule; `<label> item <n>` needs both; item lists check every item", () => {
    const root = fixture({
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

  it("R18: a heading of rule 71 does not resolve a rule 70 citation", () => {
    const root = fixture({ ...base, "docs/a.md": "rule 70 § Slots\nrule 71 § Slots\n" });
    expect(unresolved(root).map((u) => u.where)).toEqual(["docs/a.md:1"]);
  });

  it("R22: links resolve from the citing file's directory", () => {
    const root = fixture({
      ...base, "docs/agents/auditor.md": "# A\n\n## Downgrades\n",
      "docs/agents/b.md": "`../../docs/agents/auditor.md#downgrades` [ok](../../.claude/rules/71-herdr-mixed-roster.md#slots) [bad](.claude/rules/71-herdr-mixed-roster.md#slots)\n",
      "CLAUDE.md": "`docs/agents/auditor.md#downgrades` `docs/agents/auditor.md#nope`\n",
    });
    // b.md: the third link resolves to docs/agents/.claude/... which does not exist; CLAUDE.md: the second pointer is dead
    expect(unresolved(root).map((u) => u.where).sort()).toEqual(["CLAUDE.md:1", "docs/agents/b.md:1"]);
  });

  it("R23: citations wrapped across a line break are found at their first line", () => {
    const root = fixture({ ...base, "docs/a.md": "intro rule 70\n§ Nonexistent here\nand rule 70\n§ Sessions\n" });
    expect(unresolved(root).map((u) => u.where)).toEqual(["docs/a.md:1"]);
  });

  it("R24/R14: CJK paths come back unquoted; untracked files are not scanned", () => {
    const root = fixture({ ...base, "docs/架构.md": "rule 70 § Nonexistent\n" }, { "docs/untracked.md": "rule 70 § Nope\n" });
    expect(unresolved(root).map((u) => u.where)).toEqual(["docs/架构.md:1"]);
  });

  it("R13: hooks and agents are scanned", () => {
    const root = fixture({ ...base, ".claude/hooks/x.sh": "# rule 70 § Nope\n", ".claude/agents/a.md": "rule 71 § Nope\n" });
    expect(unresolved(root).map((u) => u.where).sort()).toEqual([".claude/agents/a.md:1", ".claude/hooks/x.sh:1"]);
  });

  it("R16: renaming a heading breaks a citation that resolved before", () => {
    const root = fixture({ ...base, "docs/a.md": "rule 71 § Slots\n" });
    expect(unresolved(root)).toEqual([]);
    update(root, R71, "# 71\n\n## Places\n");
    expect(unresolved(root)).toHaveLength(1);
  });

  it("R12/R26: Governing-text and binding pointers resolve; a renamed target fails", () => {
    const root = fixture({
      ...base, "docs/agents/auditor.md": "# A\n\n## Downgrades\n",
      ".agents/skills/mdpro-delegator/SKILL.md": "Apply `references/l.md#landing`.\n",
      ".agents/skills/mdpro-delegator/references/l.md": "# L\n\n## Landing\n",
      [R70]: "# 70\n\n## Sessions\n\nGoverning text: `docs/agents/auditor.md#downgrades`\n",
    });
    expect(unresolved(root)).toEqual([]);
    update(root, ".agents/skills/mdpro-delegator/references/l.md", "# L\n\n## Land\n");
    expect(unresolved(root).map((u) => u.where)).toEqual([".agents/skills/mdpro-delegator/SKILL.md:1"]);
  });

  it("resolveCitation reports an empty label", () => {
    const root = fixture(base);
    expect(resolveCitation(root, { file: "x", line: 1, rule: "70", kind: "label", label: "", raw: "" }, []).ok).toBe(false);
  });
});

describe("always-on sets and routes (fixtures)", () => {
  const scoped = '---\npaths:\n  - "src/**"\n---\n';

  it("B3/B26: imports are transitive, cycle-safe, relative to the importer, and skip code and emails", () => {
    const root = fixture({
      "CLAUDE.md": "@docs/a.md\n`@docs/x.md` a@b.md\n```\n@docs/y.md\n```\n",
      "docs/a.md": "@b.md\n", "docs/b.md": "@a.md\n",
    });
    const set = claudeAlwaysOn(root);
    expect(set.members).toEqual(["CLAUDE.md", "docs/a.md", "docs/b.md"]);
    expect(set.errors).toEqual([]);
    expect(set.bytes).toBe(Buffer.byteLength("@docs/a.md\n`@docs/x.md` a@b.md\n```\n@docs/y.md\n```\n") + 12);
  });

  it("B4/B22: a missing or outside import fails by name", () => {
    const root = fixture({ "CLAUDE.md": "@missing.md\n@~/.claude/CLAUDE.md\n@../../outside.md\n" });
    const errors = claudeAlwaysOn(root).errors.join("\n");
    expect(errors).toMatch(/missing.md/);
    expect(errors).toMatch(/~\/.claude\/CLAUDE.md.*outside/);
    expect(errors).toMatch(/outside.md.*outside/);
  });

  it("B5–B8/B10/B24/B25: what counts as path-scoped", () => {
    expect(isPathScoped(scoped)).toBe(true);
    expect(isPathScoped('---\npaths: ["src/**", "tests/**"]\n---\n')).toBe(true);
    for (const p of ["**/*", "docs/**", "**/*.md", "weird/**", ".claude/**", "docs/adr/**"]) {
      expect(isPathScoped(`---\npaths:\n  - "${p}"\n---\n`)).toBe(false);
    }
    expect(isPathScoped('---\npaths:\n  - "src/**"\n  - "weird/**"\n---\n')).toBe(false);
    expect(isPathScoped("---\npaths: []\n---\n")).toBe(false);
    expect(isPathScoped("---\npaths:\n---\n")).toBe(false);
    expect(isPathScoped('# body\n\npaths:\n  - "src/**"\n')).toBe(false);
    const root = fixture({ "CLAUDE.md": "c\n", ".claude/rules/sub/x.md": "nested\n", ".claude/rules/s.md": scoped });
    expect(claudeAlwaysOn(root).members).toEqual(["CLAUDE.md", ".claude/rules/sub/x.md"]);
  });

  const B = (...entries: string[]) => `<!-- read-every-session:begin -->\n${entries.map((e) => `- ${e}`).join("\n")}\n<!-- read-every-session:end -->\n`;

  it("B9/B10/B27: AGENTS.md's block; missing block or entry; repeated and unterminated blocks", () => {
    const root = fixture({ "AGENTS.md": B("[c](CLAUDE.md)") + "mid\n" + B("[r](.claude/rules/25.md)"), "CLAUDE.md": "c", ".claude/rules/25.md": "r" });
    const s = codexShared(root);
    expect(s.members).toEqual(["AGENTS.md", "CLAUDE.md", ".claude/rules/25.md"]);
    expect(s.errors).toEqual([]);
    const none = fixture({ "AGENTS.md": "no block\n" });
    expect(codexShared(none).errors).toContain("AGENTS.md has no read block");
    const bad = fixture({ "AGENTS.md": B("[c](missing.md)") });
    expect(codexShared(bad).errors.join()).toMatch(/AGENTS.md:2: read-block entry names no existing file/);
    const open = fixture({ "AGENTS.md": "<!-- read-every-session:begin -->\n- [c](CLAUDE.md)\nread [g](g.md) first\n", "CLAUDE.md": "c", "g.md": "g" });
    expect(codexShared(open).errors.join()).toMatch(/unterminated/);
    expect(readDirectiveViolations(open, "AGENTS.md").map((v) => v.what).join()).toMatch(/read directive/);
  });

  it("B11/B15/B28/B38: route closure follows blocks anywhere, counts whole files once, in every spelling", () => {
    const files: Record<string, string> = {
      "CLAUDE.md": "c", "AGENTS.md": B("[c](CLAUDE.md)"),
      "docs/agents/implementor.md": B("[x](x.md)", "[g](../guide/g.md#core)", "`../guide/b.md`", "../guide/bare.md",
        "<../guide/auto.md>", "[r][ref]") + "\n[ref]: ../guide/ref.md\n",
      "docs/agents/x.md": B("[y](../y.md)", "[readme](../guide/README.md)"),
      "docs/y.md": "y", "docs/guide/g.md": pad(100), "docs/guide/b.md": pad(10), "docs/guide/bare.md": pad(20),
      "docs/guide/auto.md": pad(30), "docs/guide/ref.md": pad(40), "docs/guide/README.md": "readme", "docs/README.md": "other",
      ".agents/skills/mdpro-delegator/references/templates/brief-template.md": B("[x](../../../../../docs/agents/x.md)"),
    };
    const root = fixture(files);
    const r = route(root, "implementor-brief", "codex");
    expect(r.errors).toEqual([]);
    expect(new Set(r.members).size).toBe(r.members.length);
    expect(r.members).toEqual(expect.arrayContaining(["docs/agents/x.md", "docs/y.md", "docs/guide/g.md", "docs/guide/b.md",
      "docs/guide/bare.md", "docs/guide/auto.md", "docs/guide/ref.md", "docs/guide/README.md"]));
    expect(r.members).not.toContain("docs/README.md");
    const expected = r.members.reduce((n, m) => n + Buffer.byteLength(files[m]), 0);
    expect(r.bytes).toBe(expected);
  });

  it("B20: a missing template is an error, never 0", () => {
    const root = fixture({ "CLAUDE.md": "c", "AGENTS.md": B("[c](CLAUDE.md)"), "docs/agents/auditor.md": "a" });
    expect(route(root, "auditor-audit", "claude").errors.join()).toMatch(/audit-request-template.md missing/);
  });

  it("B37/B31: a block in an always-on rule or in CLAUDE.md is counted on its runtime", () => {
    const root = fixture({
      "CLAUDE.md": B("[y](y.md)"), "AGENTS.md": B("[c](CLAUDE.md)"),
      [R71]: B("[x](../../x.md)"), "x.md": pad(5000), "y.md": pad(7),
      "docs/agents/device-tester.md": "d",
      ".agents/skills/mdpro-delegator/references/templates/device-brief-template.md": "t",
    });
    expect(claudeAlwaysOn(root).members).toEqual(expect.arrayContaining(["x.md", "y.md"]));
    expect(codexShared(root).members).toContain("y.md");
    expect(codexShared(root).members).not.toContain("x.md");
    expect(route(root, "device", "claude").members).toContain("x.md");
    expect(route(root, "device", "codex").members).not.toContain("x.md");
  });

  it("B16: sizes are UTF-8 bytes", () => {
    const root = fixture({ "CLAUDE.md": "会话" });
    expect(claudeAlwaysOn(root).bytes).toBe(6);
  });
});

describe("read directives and links outside blocks (fixtures)", () => {
  const B = (body: string) => `<!-- read-every-session:begin -->\n${body}\n<!-- read-every-session:end -->\n`;
  const lines = [
    "Read [the guide](../guide/g.md#a) before you start.",
    "Read [x](../x.md#a) first.",
    "READ [x](../x.md#a) once.",
    "Read [x](../x.md#a) in full.",
    "Before your first dispatch, open [g](../guide/g.md#a).",
    "Read every changed file in full.", // not a doc read: must pass (see below)
    "Read [x](../x.md#a) every time.",
    "At the start of every session, read [x](../x.md#a).",
    "Read `x.md` at session start.",
    "On every session, read [x](../x.md#a).",
    "Start by reading [x](../x.md#a).",
    "开始工作前先读 x.md。",
    "每次都要读 x.md。",
  ];

  it("a procedure read that names no document is not a directive", () => {
    const root = fixture({ "docs/agents/r.md": "intro\n\nRead every changed file and its callers in full.\n" });
    expect(readDirectiveViolations(root, "docs/agents/r.md")).toEqual([]);
  });

  it.each(lines.filter((l) => !l.startsWith("Read every changed")))("B12/B13/B30/B39: %s fails outside a block and passes inside", (line) => {
    const files = { "docs/x.md": "# X\n\n## A\n", "docs/guide/g.md": "# G\n\n## A\n" };
    const out = fixture({ ...files, "docs/agents/r.md": `intro\n\n${line}\n` });
    expect(readDirectiveViolations(out, "docs/agents/r.md").filter((v) => /directive/.test(v.what)).map((v) => v.where))
      .toEqual(["docs/agents/r.md:3"]);
    const inside = fixture({ ...files, "docs/agents/r.md": `intro\n\n${B(`- ${line}`)}` });
    expect(readDirectiveViolations(inside, "docs/agents/r.md").filter((v) => /directive/.test(v.what))).toEqual([]);
  });

  it("B29: a directive wrapped across lines fails at its paragraph line", () => {
    const root = fixture({ "docs/agents/r.md": "a\n\nPlease read the\nguide in\nfull.\n" });
    expect(readDirectiveViolations(root, "docs/agents/r.md").map((v) => v.where)).toEqual(["docs/agents/r.md:3"]);
  });

  it("B14/B23: anchorless repo links fail, anchored ones pass, dead anchors fail, external and comments are ignored", () => {
    const root = fixture({
      "docs/x.md": "# X\n\n## Here\n",
      "docs/agents/r.md": "[a](../x.md)\n[b](../x.md#here)\n[c](../x.md#nonexistent)\n[d](https://e.com/x.md)\n<!-- [e](../x.md) -->\n",
    });
    expect(readDirectiveViolations(root, "docs/agents/r.md").map((v) => `${v.where} ${v.what.split(":")[0]}`)).toEqual([
      "docs/agents/r.md:1 link without an anchor outside a read block", "docs/agents/r.md:3 dead anchor",
    ]);
  });

  it("readBlocks ignores prose lines inside a block", () => {
    const root = fixture({ "a.md": "<!-- read-every-session:begin -->\nThen the role file your brief names.\n- [c](c.md)\n<!-- read-every-session:end -->\n", "c.md": "c" });
    expect(readBlocks(root, "a.md")).toEqual({ entries: ["c.md"], errors: [] });
  });
});
