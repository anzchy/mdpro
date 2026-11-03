// @vitest-environment node
// D355 ruling 4 (P29, P30): after the rebase onto PR 587, the history file holds rules 70 and 71 as D355 found them, at
// 9c32bcde, under the allowances its header states: each heading one level deeper, the frontmatter as a yaml block,
// and relative links re-based from .claude/rules/ to docs/reference/.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const BASE = "9c32bcde";
const HISTORY = "docs/reference/20261027-rules-70-71-history.md";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

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

  // D355 fix 5 (M-r4-1): each section is pinned by the sha256 of its body as it stands at 9c32bcde (rule 70 blob
  // 46051f87, rule 71 blob 675c4188, under the header's transform; the fix-4 and fix-5 one-shots check it against
  // those blobs). The snapshot is a record of a past commit, so an edit falsifies it; a deliberate re-base of the
  // snapshot updates these hashes in the same commit.
  it("P29: the rule 70 and rule 71 sections are there, between their headings", () => {
    const text = read(HISTORY);
    const r70 = between(text, `## Rule 70 at ${BASE}\n\n`, `\n## Rule 71 at ${BASE}`);
    const r71 = between(text, `## Rule 71 at ${BASE}\n\n`, `\n## Rule 12 at ${BASE}`);
    expect(r71.trimEnd()).not.toBe("");
    expect(r70).toContain("`docs/agents/audit-policy-set.md` blob `<P>`");
    expect(sha(r70), "rule 70 section").toBe("624cefd763a9f8896f857b7133b41d30e6b59e688d632313a1359c3d5dc81df8");
    expect(sha(r71), "rule 71 section").toBe("178ab5bbea50e741d0fa7f522e9f68af72511fc84193ffcfde0115eaa550e789");
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
