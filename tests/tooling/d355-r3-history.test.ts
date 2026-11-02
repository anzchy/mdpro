// @vitest-environment node
// D355 ruling 4 (P29, P30): after the rebase onto PR 587, the history file holds rules 70 and 71 as D355 found them, at
// 9c32bcde, under the allowances its header states: each heading one level deeper, the frontmatter as a yaml block,
// and relative links re-based from .claude/rules/ to docs/reference/.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const BASE = "9c32bcde";
const HISTORY = "docs/reference/20261027-rules-70-71-history.md";
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const atBase = (rel: string) => execFileSync("git", ["show", `${BASE}:${rel}`], { cwd: root, encoding: "utf8" });

/** The history file's stated transform of one rule file. */
function historyForm(source: string): string {
  let out = "";
  let body = source;
  const fm = /^---\n[\s\S]*?\n---\n/.exec(body);
  if (fm) {
    out += "```yaml\n" + fm[0] + "```\n";
    body = body.slice(fm[0].length);
  }
  let fence = false;
  const lines = body.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; }
    if (fence) return line;
    const deeper = /^#{1,6} /.test(line) ? `#${line}` : line;
    return deeper.replace(/\]\(([^)\s]+)\)/g, (whole, target: string) => {
      if (/^[a-z]+:/i.test(target) || target.startsWith("#")) return whole;
      const [file, anchor] = target.split("#");
      const rebased = path.posix.normalize(`../../.claude/rules/${file}`);
      return `](${rebased}${anchor === undefined ? "" : `#${anchor}`})`;
    });
  });
  return out + lines.join("\n");
}
function between(text: string, start: string, end: string): string {
  const i = text.indexOf(start);
  expect(i, start).toBeGreaterThanOrEqual(0);
  const j = text.indexOf(end, i + start.length);
  expect(j, end).toBeGreaterThan(i);
  return text.slice(i + start.length, j);
}

describe("D355 history file at the rebased base", () => {
  it("P29: the header and every section heading name 9c32bcde, none db04d826", () => {
    const text = read(HISTORY);
    expect(text.split("\n## ")[0]).toContain(`as they stood at \`${BASE}\``);
    const headings = text.split("\n").filter((l) => /^## .+ at [0-9a-f]{8}$/.test(l));
    expect(headings).toEqual([
      `## Rule 70 at ${BASE}`, `## Rule 71 at ${BASE}`, `## Rule 12 at ${BASE}`, `## Rule 10 at ${BASE}`,
      `## CLAUDE.md at ${BASE}`, `## AGENTS.md at ${BASE}`,
    ]);
  });

  it("P29: the rule 70 and rule 71 bodies are the base's text under the stated transform", () => {
    const text = read(HISTORY);
    const r70 = between(text, `## Rule 70 at ${BASE}\n\n`, `\n## Rule 71 at ${BASE}`);
    const r71 = between(text, `## Rule 71 at ${BASE}\n\n`, `\n## Rule 12 at ${BASE}`);
    expect(r70.trimEnd()).toBe(historyForm(atBase(".claude/rules/70-multi-session-coordination.md")).trimEnd());
    expect(r71.trimEnd()).toBe(historyForm(atBase(".claude/rules/71-herdr-mixed-roster.md")).trimEnd());
    expect(r70).toContain("`docs/agents/audit-policy-set.md` blob `<P>`");
  });

  it("P30: the entries that state the pre-D355 SHA name 9c32bcde", () => {
    const foldIn = read("docs/agents/decisions/20261102-d355-rules-70-71-fold-in.md").replace(/\s+/g, " ");
    expect(foldIn).toContain(`The full text at \`${BASE}\` is in the history file`);
    expect(foldIn).not.toContain("db04d826");
    const issues = read("docs/agents/decisions/20261102-new-items-are-github-issues.md");
    expect(issues).toContain(`rule 70 at \`${BASE}\``);
    expect(issues).not.toContain("db04d826");
  });
});
