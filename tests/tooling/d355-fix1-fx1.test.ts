// @vitest-environment node
// D355 fix 1, fx1: see d355-fix1-lib.ts for the shared scanner.
import { describe, expect, it } from "vitest";
import {
  read, flat, show, BASE, CANDIDATE, rawSection, section, normalise, sentences, LA, RR, R70, R71, HISTORY, FOLD_IN, ADR, liveHomes, hitsIn, hits, anchorExists, withoutCurrentText, currentText, SUPERSEDED, CONDITIONAL,
} from "./d355-fix1-lib";
describe("FX-1: the moved audit homes state ADR-0143", () => {
  it("A1: no live home keeps the superseded round cap or auditor routing", () => {
    expect(hits(SUPERSEDED)).toEqual([]);
  });

  it("A1b: no live home brings a third round back under a confirm label", () => {
    const re = /\btwo (scoped |more )?confirms?\b|second confirm|third round|confirm rounds|after the (blind )?audit,? (at most )?two/;
    const bad = [...liveHomes(), R70, R71, "AGENTS.md"].flatMap((f) => sentences(read(f)).filter((x) => re.test(x)).map((x) => `${f}: ${x.slice(0, 100)}`));
    expect(bad).toEqual([]);
  });

  it("A1-cal: the same scanner sees every known site at the candidate", () => {
    const found = [LA, RR].flatMap((f) => hitsIn(f, show(CANDIDATE, f), SUPERSEDED)).map((h) => h.replace(/: .*$/, ""));
    for (const site of [`${RR}:20`, `${RR}:53`, `${RR}:56`, `${RR}:72`, `${LA}:121`, `${LA}:149`, `${LA}:150`, `${LA}:153`,
      `${LA}:154`, `${LA}:232`, `${LA}:236`, `${LA}:267`]) expect(found, site).toContain(site);
  });

  it("A2: § Audit merge states the pair, the blind round, the challenge by request file, both posts and two rounds", () => {
    const s = section(read(LA), "Audit merge");
    for (const p of ["ADR-0143", "`gpt-auditor`", "`opus-auditor`", "fresh pane", "Round one is blind",
      "posts both round-one reports", "at most two rounds", "one scoped confirm"]) expect(s, p).toContain(p);
    const challenge = sentences(rawSection(read(LA), "Audit merge")).filter((x) => x.includes("only one raises is challenged"));
    expect(challenge.join(" ")).toMatch(/challenge request file/);
    expect(s).not.toMatch(/dispatches\s+`mdpro-fable-auditor`\s+in\s+`audit`\s+mode/);
    // A2b (re-attack gap 1): the two rounds are the blind audit and one scoped confirm, in one sentence
    expect(sentences(rawSection(read(LA), "Audit merge")).some((x) => /at most two rounds[^.]*\b(blind )?audit\b[^.]*\bone (scoped )?confirm\b/.test(x))).toBe(true);
  });

  it("A3: § Audits under herdr sends PRs to both auditors, with security in both requests, and merges both reports", () => {
    const s = rawSection(read(LA), "Audits under herdr");
    // GREEN-time test fix: sentences() splits the bold "PRs." label from its sentence, so read the bullet whole
    const pr = normalise(s.split(/\n- /).find((b) => b.startsWith("**PRs.**")) ?? "").s;
    expect(pr.includes("gpt-auditor") && pr.includes("opus-auditor")).toBe(true);
    expect(sentences(s).some((x) => x.includes("security") && x.includes("both requests"))).toBe(true);
    expect(flat(s)).toMatch(/posts both reports/);
    expect(s).not.toMatch(/[Oo]ptional/);
  });

  it("A4: § Requests resets both auditors into fresh panes in one bullet", () => {
    const bullets = rawSection(read(LA), "Requests").split(/\n- /).map((b) => normalise(b).s);
    expect(bullets.some((b) => b.includes("gpt-auditor") && b.includes("opus-auditor") && /(fresh|new) pane/.test(b))).toBe(true);
  });

  it("A5: roster-and-routing makes opus-auditor an auditor on both routes", () => {
    const text = read(RR);
    expect(section(text, "Overlay")).toContain("ADR-0143");
    const runtime = section(text, "Runtime route");
    expect(runtime).toMatch(/`gpt-auditor` and `opus-auditor`/);
    expect(runtime).toMatch(/tells the user and the audit waits/);
    expect(runtime).not.toMatch(/does not block landing/);
    const row = rawSection(text, "Roster").split("\n").find((l) => l.startsWith("|") && l.includes("| `opus-auditor` |"));
    expect(row, "opus-auditor roster row").toBeTruthy();
    const cells = row!.split("|").map((c) => c.trim());
    expect(cells[1]).toMatch(/Auditor/);
    expect(cells[1]).not.toMatch(/Optional/);
    expect(cells[4]).toMatch(/fresh/);
    expect(cells[4]).toMatch(/request file/);
  });

  it("A6: ADR-0143's Current text points at the corrected § Audit merge, and its body is unchanged", () => {
    const rel = ADR("0143");
    expect(currentText(rel)).toContain("landing-and-audit.md#audit-merge");
    expect(anchorExists(LA, "audit-merge")).toBe(true);
    expect(withoutCurrentText(read(rel))).toBe(withoutCurrentText(show(BASE, rel)));
  });

  it("A7: the old wording lives on in the history file", () => {
    const h = read(HISTORY);
    expect(h).toContain("At most three");
    expect(h).toContain("/cc-suite:continue");
  });

  it("A8: no sentence about Opus in the audit and roster homes is conditional, except ADR-0143 decision 4's", () => {
    // re-attack gap 2: every live home plus rules 70/71 and AGENTS.md; the Low tier's challenger sentence is R2's, kept
    const bad: string[] = [];
    for (const f of [...liveHomes(), R70, R71, "AGENTS.md"]) {
      for (const x of sentences(read(f))) {
        // GREEN-time test fix: opus-imple-N names an implementor, and a CLI flag such as --dangerously-skip-permissions is no condition
        if (!/\bopus\b(?!-imple)|opus-auditor/.test(x) || !CONDITIONAL.test(x.replace(/--[\w-]+/g, ""))) continue;
        if (x.includes("unavailable") && x.includes("waits") && x.includes("user") && !/\b(alone|lands?|proceeds?|without|or)\b/.test(x)) continue;
        if (/^- low \(/.test(x) || (x.includes("gpt-auditor alone") && x.includes("challeng"))) continue;
        bad.push(`${f}: ${x.slice(0, 120)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("A9: Fable is named in the audit homes only as the opus-auditor pane's fallback", () => {
    const bad: string[] = [];
    for (const f of liveHomes()) {
      for (const x of sentences(read(f))) {
        if (!/\bfable\b|fable-auditor/.test(x)) continue;
        if (/when (the )?opus-auditor( pane)? cannot start/.test(x) && !x.includes("no fallback")) continue;
        bad.push(`${f}: ${x.slice(0, 120)}`);
      }
    }
    expect(bad).toEqual([]);
    expect(section(read(RR), "Subagents")).not.toContain("second auditor of item 4");
  });

  it("A10: ADR and plan review, and the round-one posts, go to both auditors", () => {
    const merge = rawSection(read(LA), "Audit merge");
    const herdr = rawSection(read(LA), "Audits under herdr");
    const bulletOf = (raw: string, head: string) => normalise(raw.split(/\n\s*- /).find((b) => b.includes(head)) ?? "").s;
    for (const b of [bulletOf(merge, "**ADRs and plans**"), bulletOf(herdr, "**ADRs and plans.**")]) {
      expect(b).toContain("gpt-auditor");
      expect(b).toContain("opus-auditor");
    }
    const row = normalise(rawSection(read(RR), "Roster").split("\n").find((l) => l.startsWith("| ADR and plan reviewer")) ?? "").s;
    expect(row).toContain("gpt-auditor");
    expect(row).toContain("opus-auditor");
    const post = sentences(rawSection(read(RR), "Overlay")).find((x) => x.includes("round-one reports")) ?? "";
    expect(post).toContain("both");
  });

  it("A11: after round two the user rules (ADR-0129), never another owner fix by default", () => {
    const merge = sentences(rawSection(read(LA), "Audit merge"));
    expect(merge.some((x) => x.includes("round two") && x.includes("user") && x.includes("adr-0129"))).toBe(true);
    expect(merge.filter((x) => /another (fix|round)/.test(x) && x.includes("owner") && !x.includes("user"))).toEqual([]);
  });

  it("A12: the fold-in entry records the ADR-0143 rewrites and no longer calls the moves verbatim", () => {
    const e = flat(read(FOLD_IN));
    for (const a of ["landing-and-audit.md#audit-merge", "#audits-under-herdr", "#requests", "roster-and-routing.md#overlay",
      "#runtime-route", "#roster"]) expect(e, a).toContain(a);
    expect(e).toContain("rewritten to ADR-0143");
    expect(e).not.toMatch(/verbatim moves and restatements/);
    expect(e).not.toMatch(/The procedures move verbatim/);
  });

  it("A13: the Low tier keeps its meaning, with opus-auditor in Fable's place", () => {
    const low = sentences(rawSection(read(LA), "Tiers")).filter((x) => x.includes("low (")).join(" ");
    expect(low).not.toContain("fable");
    for (const p of ["opus-auditor", "adr-0137", "adr-0121", "adr-0143", "unchanged", "alone"]) expect(low, p).toContain(p);
    expect(low).toMatch(/gpt-auditor alone/);
    expect(low).toMatch(/opus-auditor[^.]*challeng[^.]*critical or high/);
    expect(low).not.toMatch(/not alone|both auditors|opus-auditor alone/);
  });
});

