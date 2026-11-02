// @vitest-environment node
// D355 ruling 3 (P26, P27, P15'): PR 587's policy-set pin lives in D355's new homes, once each, and D355's own record no
// longer claims what PR 587's entry decided (the 13,000 B allowance, the two auditor caps) or the retired issue-586
// exception.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");
const count = (text: string, phrase: string) => text.split(phrase).length - 1;
/** The flattened text of `## heading` up to the next `## `. */
function section(text: string, heading: string): string {
  const at = text.indexOf(`\n## ${heading}\n`);
  if (at < 0) return "";
  const next = text.indexOf("\n## ", at + 4);
  return flat(text.slice(at, next < 0 ? undefined : next));
}

const SPLIT_ENTRY = "20261102-audit-policy-set-split.md";
const ROUTED = "`docs/agents/audit-policy-set.md` blob `<P>` when the pinned file's § Which set names `<P>`";
const ISSUE_586 = ["#", "586"].join("");

describe("P26: docs/agents/auditor.md carries the policy pin beside the dimension pin", () => {
  const text = read("docs/agents/auditor.md");

  it("the intro names <P> beside <B>", () => {
    const intro = flat(text.slice(0, text.indexOf("\n## ")));
    expect(intro).toContain("`<B>`");
    expect(intro).toContain("`<P>`");
  });

  it("§ Dimensions carries the routed string and says to echo <P> beside <B>", () => {
    const dims = section(text, "Dimensions");
    expect(dims).toContain(ROUTED);
    expect(dims).toMatch(/[Ww]hen the request names `<P>`, echo it beside `<B>`/);
  });
});

describe("P27: the D355 fold-in entry and ADR-0147's D355 Status line point to the policy-split entry", () => {
  const entry = read("docs/agents/decisions/20261102-d355-rules-70-71-fold-in.md");

  it("supersedes no allowance and names no retired exception", () => {
    const supersedes = flat(entry).match(/\*\*supersedes:\*\*(.*?)- \*\*gate-sensitive/)?.[1] ?? "";
    expect(supersedes).not.toBe("");
    expect(supersedes).not.toContain("11,500");
    expect(supersedes).not.toContain("13,000");
    for (const gone of ["known exception", "over its allowance", ISSUE_586]) expect(flat(entry)).not.toContain(gone);
  });

  it("§ Changed points to the policy-split entry for the allowance and both auditor caps", () => {
    expect(section(entry, "Changed")).toContain(SPLIT_ENTRY);
  });

  it("ADR-0147's D355 Status line no longer claims the 13,000 B allowance", () => {
    const adr = fs.readdirSync(path.join(root, "docs/adr")).find((f) => f.startsWith("0147-"))!;
    const line = read(`docs/adr/${adr}`).split("\n").find((l) => l.includes("20261102-d355-rules-70-71-fold-in.md"));
    expect(line).toBeDefined();
    expect(line).not.toContain("13,000");
  });
});

describe("P15': each routed sentence has one home among the delegator references", () => {
  const dir = ".agents/skills/mdpro-delegator/references";
  const refs = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".md")).map((f) => read(`${dir}/${f}`));
  const all = refs.map(flat).join("\n");
  const landing = read(`${dir}/landing-and-audit.md`);

  it("the routed string occurs three times, once in each of item 4, § Tiers and § Audits under herdr", () => {
    expect(count(all, ROUTED)).toBe(3);
    const audit = section(landing, "Audit merge");
    const item4 = audit.slice(audit.indexOf("4. **Every WI"));
    expect(audit.indexOf("4. **Every WI")).toBeGreaterThanOrEqual(0);
    expect(count(item4, ROUTED)).toBe(1);
    expect(count(section(landing, "Tiers"), ROUTED)).toBe(1);
    expect(count(section(landing, "Audits under herdr"), ROUTED)).toBe(1);
  });

  it("the docs-only exception and the Low bullet occur once each", () => {
    expect(count(all, "`docs/agents/audit-dimensions.md` or `docs/agents/audit-policy-set.md` goes through a PR")).toBe(1);
    expect(count(all, "docs except `docs/agents/audit-dimensions.md` and `docs/agents/audit-policy-set.md`")).toBe(1);
  });

  it("rules 70 and 71 hold no copy", () => {
    for (const rule of [".claude/rules/70-multi-session-coordination.md", ".claude/rules/71-herdr-mixed-roster.md"]) {
      expect(count(flat(read(rule)), "audit-policy-set.md"), rule).toBe(0);
    }
  });
});
