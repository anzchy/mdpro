// @vitest-environment node
// D355, ADR-0147 decision 4: every citation of rule 70 or 71 in the tree resolves to a heading that exists, or through
// docs/reference/adr-0147-rule-section-map.json, and every Governing-text link and binding pointer resolves.
// The checker is tests/tooling/rules-budget-lib.ts; its fixture self-tests are rules-budget-lib.test.ts.
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  citationScanSet, findCitations, githubSlug, headingsAt, loadMap, readRel, RULE_FILES, scanCitations, SECTION_MAP,
} from "./rules-budget-lib";
import fs from "node:fs";

const root = path.resolve(__dirname, "../..");

// The H2 and H3 headings of rules 70 and 71 at db04d826, the commit the trim started from (R25).
const HEADINGS_AT_BASE: Record<"70" | "71", string[]> = {
  "70": [
    "Sessions", "How work is assigned", "When a session is idle: pull from its queue", "Questions and approvals",
    "Commits and branches", "Reserving numbers", "Session rotation", "The Mac mini", "Device-check batches",
  ],
  "71": [
    "Delegator runtime route", "Roster", "Codex agents", "Fresh context", "Briefs and self-acceptance",
    "Audits under herdr", "Slots",
  ],
};

describe("rule 70 and 71 citations resolve (live tree)", () => {
  const scan = scanCitations(root);

  it("the section map exists and every row's targets resolve", () => {
    expect(fs.existsSync(path.join(root, SECTION_MAP)), `${SECTION_MAP} is missing`).toBe(true);
    expect(loadMap(root).length).toBeGreaterThan(0);
    expect(scan.mapProblems).toEqual([]);
  });

  it("every citation, anchor link, Governing-text link and binding pointer resolves", () => {
    expect(scan.unresolved.map((u) => `${u.where}  ${u.raw}  — ${u.reason}`)).toEqual([]);
    // a scanner that finds nothing cannot pass (R2)
    expect(scan.count).toBeGreaterThanOrEqual(150);
  });

  it("every heading the rules had at db04d826 is still there, with its anchor (R25)", () => {
    for (const rule of ["70", "71"] as const) {
      const slugs = (headingsAt(root, RULE_FILES[rule]) ?? []).map((h) => h.slug);
      for (const h of HEADINGS_AT_BASE[rule]) expect(slugs, `rule ${rule} lost ## ${h}`).toContain(githubSlug(h));
    }
  });

  it("each kind of scanned file contributes citations, and ADR-0146's `rule 70 Commits item 4` is found (R13, R27)", () => {
    const files = citationScanSet(root);
    const found = (f: string) => findCitations(f, readRel(root, f));
    const kinds = { md: 0, hooks: 0, agents: 0 };
    for (const f of files) {
      const n = found(f).length;
      if (f.startsWith(".claude/hooks/")) kinds.hooks += n;
      else if (f.startsWith(".claude/agents/")) kinds.agents += n;
      else kinds.md += n;
    }
    expect(kinds.md).toBeGreaterThan(0);
    expect(kinds.hooks).toBeGreaterThan(0);
    expect(kinds.agents).toBeGreaterThan(0);
    const adr = files.find((f) => f.startsWith("docs/adr/0146-"))!;
    expect(found(adr).some((c) => c.line === 49 && c.label === "Commits" && c.item === 4)).toBe(true);
  });

  it("rule 70 § Sessions still states the role limits role-guard.sh enforces (R28, ADR-0147 d4)", () => {
    const text = readRel(root, RULE_FILES["70"]);
    const start = text.indexOf("\n## Sessions\n");
    const end = text.indexOf("\n## ", start + 5);
    const body = text.slice(start, end < 0 ? undefined : end);
    for (const phrase of ["MDPRO_ROLE", "role-guard.sh", "AskUserQuestion", "git push", "master", "git add -A", "state.json", "MDPRO_REPORT_DIR"]) {
      expect(body, `§ Sessions lost "${phrase}"`).toContain(phrase);
    }
  });
});
