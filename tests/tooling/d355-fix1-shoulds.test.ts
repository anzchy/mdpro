// @vitest-environment node
// D355 fix 1, shoulds: see d355-fix1-lib.ts for the shared scanner.
import { describe, expect, it } from "vitest";
import {
  read, flat, count, sha, ISSUE_592, rawSection, section, normalise, sentences, SK, REF, LA, RR, CP, R70, R71, R12, IMPL, FOLD_IN, BRIEF_T, FIX_T, ADR, liveHomes, hitsIn, anchorExists, unresolvedSectionRefs, SECTION_PLACEHOLDERS, heldBody, currentText, addStatusParagraph, LATER_FOLD, isForwardLink, unresolvedForwardLinks,
} from "./d355-fix1-lib";
// D3's pins (#629): ADR-0085's and ADR-0134's bodies, and each one's forward-link paragraphs at 22ffe5ea by sha256
// (0085: its 2026-10-28 partially superseded and D355's Current text; 0134: decision 7's partially superseded and D355's)
const D3_BODIES: Record<string, string> = {
  "0085": "e82b18283bc1d7295ff05028a7b31894994bfed61b53bbe7d83ed00a3afce251",
  "0134": "2c73c259a2c7f948028bc4468887dad0faedec84ec609baa3f8c5cfcadd0c4f7",
};
const D3_BASE: Record<string, string[]> = {
  "0085": ["c306ace53e16f5b721f330f5524952c579f5976d0bac39331ffa13a43c7c8561", "d15a5b9dd34c7329ca8b188b43a0313fb5f22dc0d99ba3ba6eee1cb8ba0c4dec"],
  "0134": ["590e18c9e3ee850a3342882db78eb49cd45a48370526e0104ee4c37718cfca27", "af936fd2c495b613825aaab9d1d2e3c916065e54cd6c5058e5f74d1f21b0e084"],
};
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
    // the accepted records are immutable: their bytes at 22ffe5ea (blobs b58c7599, aa0f8aa4), less their forward-link
    // paragraphs (#629 re-recorded both: each is the old pin's text less one "partially superseded"). Those paragraphs
    // are pinned as a set, by hash (D3_BASE); only a correctly formed addition is free (#629 fix 1)
    for (const n of ["0085", "0134"]) {
      expect(heldBody(read(ADR(n)), D3_BASE[n]).missing, n).toEqual([]);
      expect(sha(heldBody(read(ADR(n)), D3_BASE[n]).body), n).toBe(D3_BODIES[n]);
      // #629: a later permitted Status paragraph does not count as a body change
      expect(sha(heldBody(addStatusParagraph(read(ADR(n)), LATER_FOLD), D3_BASE[n]).body), `${n} + later fold`).toBe(D3_BODIES[n]);
    }
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

  it("D3 #629 fix 1: deleting, editing or repointing an existing forward link of ADR-0085 or ADR-0134 fails the pin", () => {
    for (const n of ["0085", "0134"]) {
      const text = read(ADR(n));
      const paras = text.split("\n\n").filter((p) => D3_BASE[n].includes(sha(p)));
      expect(paras, n).toHaveLength(2);
      for (const [i, p] of paras.entries()) {
        const ref = p.match(/\(([^)\s]+\.md)\)|`([^`]+#[^`]+)`/)!;
        const target = ref[1] ?? ref[2];
        for (const changed of [
          text.replace(`${p}\n\n`, ""),
          text.replace(p, p.replace(/decision \d|D355/, (m) => `${m}x`)),
          text.replace(p, p.replace(target, target.replace(/\.md/, "-other.md"))),
        ]) {
          expect(changed, `${n} paragraph ${i}`).not.toBe(text);
          expect(heldBody(changed, D3_BASE[n]).missing, `${n} paragraph ${i}`).toEqual([D3_BASE[n][i]]);
        }
      }
    }
  });

  it("D3 #629 fix 2: a forward link added to ADR-0085 is the whole paragraph and names a real, newer record", () => {
    const rel = ADR("0085");
    const file = rel.slice("docs/adr/".length);
    const text = read(rel);
    // each case: the paragraph, and what the target check reports for it (empty where only the form's shape is wrong)
    const cases: [string, string, string[]][] = [
      ["a missing ADR", "Superseded by [ADR-9999](9999-does-not-exist.md).",
        [`${file}: ADR-9999: no such record`, `${file}: 9999-does-not-exist.md: file missing`]],
      ["trailing prose", "Superseded by ADR-0165. Decision 1 is now void.", []],
      ["a dated trailing clause", "2026-11-04 Superseded by ADR-0165; decision 1 is now void.", []],
      ["a single-newline heading", "Superseded by ADR-0165.\n## Decision\n1. Nothing is audited.", []],
      ["an older ADR", "Superseded by [ADR-0001](0001-wysiwyg-link-scheme-allowlist.md).",
        [`${file}: ADR-0001: not newer than ADR-0085`]],
      ["a Drifted with missing evidence", "2026-11-04 Drifted: the code no longer does this ([evidence](../test/does-not-exist.md)).",
        [`${file}: ../test/does-not-exist.md: file missing`]],
      ["a False in practice with missing evidence", "2026-11-04 False in practice: [evidence](../test/does-not-exist.md).",
        [`${file}: ../test/does-not-exist.md: file missing`]],
    ];
    for (const [name, para, target] of cases) {
      const changed = addStatusParagraph(text, para);
      expect(changed, name).not.toBe(text);
      expect(isForwardLink(para, "0085"), name).toBe(false);
      expect(sha(heldBody(changed, D3_BASE["0085"]).body), name).not.toBe(D3_BODIES["0085"]);
      expect(unresolvedForwardLinks(file, changed).bad, name).toEqual(target);
    }
    // the same forms, well made, are free and resolve
    for (const para of [
      "Superseded by [ADR-0165](0165-adrs-record-architecture-and-product-decisions-only.md), 2026-11-04.",
      "2026-11-04 Drifted: the code no longer does this ([evidence](../test/20260921-d5-d6-real-device-measurement.md)).",
      "2026-11-04 False in practice: [evidence](../test/20260921-d5-d6-real-device-measurement.md).",
    ]) {
      const changed = addStatusParagraph(text, para);
      expect(isForwardLink(para, "0085"), para).toBe(true);
      expect(heldBody(changed, D3_BASE["0085"]), para).toEqual({ body: heldBody(text, D3_BASE["0085"]).body, missing: [] });
      expect(unresolvedForwardLinks(file, changed).bad, para).toEqual([]);
    }
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
