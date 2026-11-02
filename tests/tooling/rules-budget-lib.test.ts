// @vitest-environment node
// D355 (ADR-0147 d5): self-tests of the budget half of the checker. Fixture trees only; the live tree is asserted in
// always-on-budget.test.ts. The citation half's self-tests are in rule-citations-lib.test.ts.
import { afterAll, describe, expect, it } from "vitest";
import {
  claudeAlwaysOn, codexShared, isPathScoped, readBlocks, readDirectiveViolations, route,
} from "./rules-budget-lib";
import { cleanupFixtures, fixture, pad, R71 } from "./rules-budget-fixture";

afterAll(cleanupFixtures);


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
