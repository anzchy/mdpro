// @vitest-environment node
// D355 fix 1, shoulds: see d355-fix1-lib.ts for the shared scanner.
import { describe, expect, it } from "vitest";
import {
  read, flat, count, sha, ISSUE_592, rawSection, section, normalise, sentences, SK, REF, LA, RR, CP, R70, R71, R12, IMPL, FOLD_IN, BRIEF_T, FIX_T, ADR, liveHomes, hitsIn, anchorExists, unresolvedSectionRefs, SECTION_PLACEHOLDERS, withoutCurrentText, currentText,
} from "./d355-fix1-lib";
describe("Shoulds: fN4–fN13, gN4–gN5", () => {
  it("D1: codex-panes.md links AGENTS.md's renamed section", () => {
    const t = read(CP);
    expect(t).not.toContain("Read first (Codex)");
    expect(t).not.toContain("which lists this rule");
    expect(count(t, "AGENTS.md#every-session-codex")).toBeGreaterThanOrEqual(2);
    expect(anchorExists("AGENTS.md", "every-session-codex")).toBe(true);
  });

  it("D2: no dangling intra-rule § reference survives in a live home", () => {
    // GREEN-time test fix: a moved-from comment names the old home on purpose, so comments are not scanned
    const live = liveHomes().map((f) => [f, read(f).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "))] as const);
    expect(live.flatMap(([f, t]) => hitsIn(f, t, [
      "by § Restart", "(§ Restart)", "§ Fresh context", "§ Delegator runtime route", "rule 71 § Briefs",
      "§ Device rules of rule 70", "the win-desktop lock above", "the alias table above", "the Opus rule above",
      "Low-tier slot in § Slots", "follows § Fresh",
    ]))).toEqual([]);
    for (const f of [LA, IMPL, RR]) expect(read(f), f).toContain("codex-panes.md#restart");
    expect(read(FIX_T)).toContain("implementor.md#fix-sessions");
    expect(read(`${REF}/session-ops.md`)).not.toMatch(/this table\b(?![^.\n]*`)/);
    expect(read(`${SK}/scripts/reset-codex.sh`)).not.toContain("Rule 71 § Restart");
  });

  it("D2-structural: every § reference in a live home resolves to a heading in the file it names", () => {
    expect(liveHomes().flatMap((f) => unresolvedSectionRefs(f, read(f)))).toEqual([]);
  });

  // D355 fix 2 (both auditors' receipt rulings): a lowercase § word is checked unless it is a known placeholder
  it("D12: a lowercase § that names no heading is reported; real lowercase headings and the placeholders are not", () => {
    const home = `${REF}/session-ops.md`;
    const at = (text: string) => unresolvedSectionRefs(home, text);
    expect(at("See § missing for the rest.")).toEqual([`${home}:1: § missing → ${home}`]);
    expect(at("Rule 70 says so, by rule 70 § mistyped.")).toHaveLength(1);
    expect(at("Read `docs/agents/audit-dimensions.md` § nosuch first.")).toHaveLength(1);
    expect(at("Read `docs/agents/audit-dimensions.md` § plan, and `docs/agents/audit-dimensions.md` § mini.")).toEqual([]);
    expect(at("<report path § finding>, and the request still holds § policy names no <P>.")).toEqual([]);
    expect([...(SECTION_PLACEHOLDERS ?? [])].sort()).toEqual(["finding", "policy"]);
  });

  // GREEN-time allowlist, each read by hand: the referent is in the same section of the same file
  const PROSE_REVIEWED = new Set([
    `${LA}: the confirmation above`, // the rule 25 confirmation two sentences earlier
    `${RR}: the rule 70 clauses it names below`, // the Overlay list that follows
    `${RR}: the device roster is replaced above`, // the Overlay's first bullet
    `${REF}/templates/challenge-request-template.md: the finding below`, // the template's finding block
    `${REF}/templates/matrix-attack-prompt.md: the three paths below`, // the prompt's path list
  ]);

  it("D2-prose: no live home points at a section by prose instead of §", () => {
    // re-attack gap 10: "the Restart section", "the rule above on Opus" dodge the § scan
    const re = /\bthe [A-Z][\w-]*( [\w-]+){0,3} section\b|\bthe [\w -]{3,30} (above|below)\b/g;
    const bad: string[] = [];
    for (const f of liveHomes()) {
      read(f).replace(/<!--[\s\S]*?-->/g, "").split("\n").forEach((l, i) => {
        for (const m of l.matchAll(re)) {
          if (/\]\(/.test(l.slice(m.index!, m.index! + m[0].length + 3))) continue;
          if (PROSE_REVIEWED.has(`${f}: ${m[0]}`)) continue;
          bad.push(`${f}:${i + 1}: ${m[0]}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("D3: ADR-0085 and ADR-0134 point at the clauses they decided; auditor.md cites the user decision", () => {
    const l85 = currentText(ADR("0085"));
    expect(l85).toContain("70-multi-session-coordination.md#commits-and-branches");
    expect(l85).toContain("landing-and-audit.md#audit-merge");
    expect(l85).not.toContain("auditor.md#downgrades");
    const l134 = currentText(ADR("0134"));
    for (const a of ["device-tester.md#mac-mini", "roster-and-routing.md#roster", "codex-panes.md#restart", "device-batches.md#device-routing"]) {
      expect(l134, a).toContain(a);
    }
    // the accepted bodies are immutable: their bytes at 22ffe5ea (blobs b58c7599, aa0f8aa4), less the Current text line
    const bodies: Record<string, string> = {
      "0085": "23c1faaab46b40ab2fcea0d04daf13eb78b3d02be45df4e57e2f34a649e807fa",
      "0134": "efd568390b3e71affb8db11600f0630d327c8dbe4bf54158442138c4b45c3c42",
    };
    for (const n of ["0085", "0134"]) expect(sha(withoutCurrentText(read(ADR(n)))), n).toBe(bodies[n]);
    const entry = read(FOLD_IN);
    expect(entry.split("\n").find((l) => l.startsWith("| 0085 |"))).toContain("70-multi-session-coordination.md#commits-and-branches");
    expect(entry.split("\n").find((l) => l.startsWith("| 0134 |"))).toContain("device-batches.md#device-routing");
    for (const [file, anchor] of [[R70, "commits-and-branches"], [RR, "roster"], [CP, "restart"],
      [`${REF}/device-batches.md`, "device-routing"], ["docs/agents/device-tester.md", "mac-mini"]]) {
      expect(anchorExists(file, anchor), `${file}#${anchor}`).toBe(true);
    }
    const down = section(read("docs/agents/auditor.md"), "Downgrades");
    expect(down).toContain("user decision 2026-10-16");
    expect(down).not.toContain("ADR-0085");
  });

  it("D4: the Q&A header's moved block reads whole, once", () => {
    const q = read("docs/reference/user-question-and-answer.md");
    const header = q.slice(0, q.indexOf("\n## Entries"));
    const lines = header.split("\n");
    const at = lines.findIndex((l) => l.includes("moved-from: CLAUDE.md § User questions and answers"));
    expect(lines[at + 1]).toMatch(/^- \*\*Where to read more/);
    expect(flat(header)).toContain("A reusable how-to answer that has no home yet gets one under");
    expect(count(header, "Rows are not edited after commit")).toBe(1);
    expect(q).not.toContain("The delegator maintains it");
    expect(section(read(`${REF}/session-ops.md`), "Q&A record")).toContain("The delegator maintains it");
  });

  it("D5: rule 70's audit bullet keeps the docs-only exemption", () => {
    const bullet = flat(read(R70)).match(/\*\*Every item is audited[^]*?(?= - `master`)/)?.[0] ?? "";
    expect(bullet).toContain("docs-only or device-record commit is not");
    expect(bullet).toContain("#audit-merge");
  });

  it("D6: rule 12 routes an implementor's question through the delegator", () => {
    const p = flat(read(R12)).match(/\*\*If any is missing[^]*?(?=Reasons, options)/)?.[0] ?? "";
    expect(p).toContain("through the delegator");
  });

  it("D7: rule 50 says a new command needs no capability entry, and the Codex project rules agree", () => {
    const r50 = section(read(".claude/rules/50-codebase-conventions.md"), "2. Tauri IPC Pattern");
    expect(r50).toContain("capabilities/default.json");
    expect(r50).toMatch(/does \*\*not\*\* need|does not need/);
    const pr = read(".codex/skills/mdpro-dev/references/project-rules.md");
    expect(pr).not.toMatch(/need capability entries/);
    expect(pr).toContain("capabilities/default.json");
    expect(pr).toContain("core:*");
  });

  it("D8: superseded routing is out of the role files and the roster reference", () => {
    const dt = read("docs/agents/device-tester.md");
    for (const bad of ["mdpro-device-harness", "dtrack", "real-device-tester runs", "Dim text"]) expect(dt, bad).not.toContain(bad);
    expect(normalise(read(`${REF}/device-batches.md`)).s).not.toMatch(/device tester is mac-test/);
    const rr = read(RR);
    for (const bad of ["Two implementation slots machine-wide", "one exception to the Opus rule", "Device checks move to `gpt-imple-3`"]) {
      expect(rr, bad).not.toContain(bad);
    }
    const guide = rawSection(rr, "Guide roster");
    if (guide) {
      expect(flat(guide)).toMatch(/as of \d{4}-\d{2}-\d{2}/);
      expect(guide).toContain("#roster");
      expect(guide).toContain("ADR-0156");
    }
    expect(section(rr, "Overlay")).toMatch(/three/);
    if (read(`${REF}/guide.md`).includes("#guide-roster")) expect(anchorExists(RR, "guide-roster")).toBe(true);
  });

  it("D9: existing D rows are still updated, in all three places", () => {
    for (const f of ["docs/agents/decisions/20261102-new-items-are-github-issues.md", "CLAUDE.md", `${REF}/templates/landing-docs-checklist.md`]) {
      const t = flat(read(f));
      expect(t, f).toContain("still updated by the commit that finishes");
      expect(t, f).not.toContain("stay unchanged as the record");
    }
  });

  it("D10: fN13 as reviewed: the entry records the narrow ADR-0147 change with exact figures; both templates carry the field", () => {
    const e = flat(read(FOLD_IN));
    expect(count(e, "「Brief names them (Recommended)」")).toBeGreaterThanOrEqual(1);
    for (const p of ["ADR-0147", "decisions 5 and 9", "only", "98de0c69", "45,302", "5,716", "51,018", "3,018", "48,000", ISSUE_592]) {
      expect(e, p).toContain(p);
    }
    const field = "Before editing any matching path, open each rule named for that path in AGENTS.md.";
    for (const t of [BRIEF_T, FIX_T]) {
      const s = flat(read(t));
      expect(s, t).toContain("Rules for paths in scope");
      expect(s, t).toContain(field);
      expect(s, t).toContain(ISSUE_592);
      expect(s, t).not.toContain("when the item touches code");
    }
    expect(e).not.toContain("when the item touches code");
    const a = read("AGENTS.md");
    expect(flat(a)).toContain("opens them by hand when it is about to edit a matching path");
    const row = (rule: string) => a.split("\n").find((l) => l.startsWith("|") && l.includes(rule)) ?? "";
    expect(row("22-comment-maintenance.md")).toContain("`scripts/**`");
    expect(row("22-comment-maintenance.md")).toContain("`.claude/hooks/**`");
    expect(row("50-codebase-conventions.md")).not.toContain("`scripts/**`");
    expect(row("50-codebase-conventions.md")).not.toContain("`.claude/hooks/**`");
  });

  it("D11: no live home calls opus-imple-1 retired; the current implementor set matches rule 71", () => {
    const bad = liveHomes().flatMap((f) => sentences(read(f))
      .filter((x) => x.includes("opus-imple-1") && /retir|stood down|closed|no longer/.test(x) && !/^as of 20\d\d-\d\d-\d\d/.test(x))
      .map((x) => `${f}: ${x.slice(0, 100)}`));
    expect(bad).toEqual([]);
    const names = (s: string) => [...s.matchAll(/(?:gpt|opus)-imple-\d/g)].map((m) => m[0]).sort();
    const r71 = read(R71).split("\n").find((l) => l.startsWith("| Implementor |")) ?? "";
    const current = read(RR).split("\n").find((l) => l.startsWith("Implementors:")) ?? "";
    expect(new Set(names(current))).toEqual(new Set(names(r71)));
  });
});
