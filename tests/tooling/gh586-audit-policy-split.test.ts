// @vitest-environment node
// GH586-ACC: the policy set moves out of audit-dimensions.md into audit-policy-set.md (ruling 1: pure move,
// dimension allowance 13,000 B). Base for the byte-identity checks: db04d826:docs/agents/audit-dimensions.md.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addStatusParagraph, heldBody, LATER_FOLD } from "./d355-fix1-lib";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
};
const dims = () => read("docs/agents/audit-dimensions.md");
const policy = () => read("docs/agents/audit-policy-set.md");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

function section(source: string, heading: string): string {
  const start = source.indexOf(`## ${heading}\n`);
  if (start < 0) return "";
  const end = source.indexOf("\n## ", start + 3);
  return source.slice(start, end < 0 ? undefined : end);
}

// Base lines of the four sections ruling 1 lets change that are not on the changed-line allow list
// (base lines 10, 11, 12, 14, 15, 27–46, 218, 230, 250, 251). Each must survive verbatim.
const keptBaseLines: string[] =
  [
    "## How this file is read",
    "- One pin covers a whole review: round one, its challenges, the confirm and the confirm's challenges all use round",
    "## Which set",
    "| Tier (ADR-0121) | Set |",
    "|---|---|",
    "| High | **full** (F1–F9) + **L** + **A** + § Security review |",
    "| Medium | **mini** (M1–M5) + **L** + **A** |",
    "| Low | **mini** (M1–M5) + **L** + **A** |",
    "| ADR or plan review | **plan** (P1–P5) |",
    "| Gate-sensitive decision-log entry, plan review | **plan** (P1–P5) + **policy** (cc-suite NL), Full |",
    "Every dimension in the set gets a `COVERAGE` entry. A dimension the change cannot touch is `n/a` with a reason in a",
    "few words (`L n/a: CSS only`). Dropping a dimension to save time is a skipped dimension, and the report is re-asked.",
    "Read `.claude/rules/60-review-checklist.md` (at `<M>`) first. Its Critical Pass items (IPC trust, races, data-loss",
    "paths, enum completeness) are mdpro's own definition of what a High looks like.",
    "Read from the diff outward (ADR-0138 decision 4): start with `git diff --stat`, the diff, the changed tests and the",
    "ACs. Treat the implementor's entry-path and await map as an index to verify, not a scope. Build your own map: every",
    "acquirer of each lock the range touches or calls under, every writer and deleter of each persisted value it changes",
    "(drafts, preferences, files, receipts), every caller, and the window, close and quit lifecycles that reach them. Read",
    "those in full. On a `hard` range, also read every changed file and its callers in full.",
    "### Split recommendation",
    "A range with more than about 400 changed production lines (added plus deleted in `git diff --numstat base..sha`) gets",
    "one Medium recommending a split. It is advisory and opens no fix round.",
    "- Excluded: `tests/`, `*_tests.rs`, inline `#[cfg(test)]` modules (estimate from the diff), `docs/`, lockfiles,",
    "- Counted: `src/`, `src-tauri/src/`, `scripts/`, `.claude/` and `.agents/`.",
    "## Report shape",
    "```",
    "COVERAGE  M1|F1|rules D1 ok — <what was read> · … · L <see below, when in the set> · A ok|n/a — <reason>",
    "  L       <site file:line> — (1) handled: <guard or test> | F<n> | n/a: <why> · (2) … · (5) …   (one line per site)",
    "AC        AC-1 PROVED|NOT PROVED|WRONG — <own evidence>   (one line per AC)",
    "FINDINGS",
    "  F1. [Critical|High] <dimension> · <file:line> · <issue>",
    "      evidence: <trace | test or command output | reproduction | rule-60 file:line | AC contradiction>",
    "      why tests miss it: <one line>   (traced runtime defects)",
    "      origin: <introducing commit in base..sha | Pre-existing, with the ADR-0121 proof>",
    "      fix: <one line>",
    "  M1. [Medium] <dimension> · <file:line> · <issue>   (one line each)",
    "CONFIRM   (confirm) <finding id>: CLOSED|PARTIAL|OPEN — <evidence>",
    "CHALLENGE (challenge) CONFIRMED|REFUTED|UNTRACED — <trace, reproduction or counter-proof>; UNTRACED only for a \"trace this\" lifecycle Medium, which stays a listed Medium",
    "COUNT     C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n>",
    "SECURITY  C<n> H<n> M<n> L<n>   (High tier, unless policy-only)",
    "```",
    "- `BLOCKING` leaves out Highs tagged Pre-existing that meet ADR-0121 decision 3.",
    "- A blanket `L ok` is a skipped dimension.",
    "- The delegator re-asks, in the same round, a report that has no `COVERAGE` line, skips a dimension without a reason,"
  ];

const untouched: Record<string, string> = {
  "mini (M1–M5)": "1b92061fb9f11e3eed6fb5fdba53cb3d368051c3f1fda454889d6e84d76f4754",
  "full (F1–F9)": "43b006da0a481bd3c5ce55623b7ae0da34b90e4b6bd6a151b313367b16d4719d",
  "L. Lifecycle & concurrency (every tier)": "d6e79cd2f5f6b14c2617393cfd34ad7e52b75d3ce69683c34186c6ec7ac2699c",
  "A. Evidence proves each AC (every tier)": "c3d3327128f6075e37700fa16935932baf3bf3e58c30bb74c83f3099a946cdc9",
  "plan (P1–P5)": "1f04a97cefbe26e99982916de48da224b0c8cf4ac174180c8173d69f6f4d4378",
  "Security review (High tier, both auditors)": "ae6aa5b68a6d009fb7bbe0a9b27f51c7725d6c05cf2c7f02d873e4724aa4fcb1",
};

const policyGlobs = [
  "`.claude/rules/`", "`CLAUDE.md`", "`AGENTS.md`", "`docs/**`", "`.agents/skills/**/*.md`",
  "`.claude/skills/**/*.md`", "`.claude/agents/*.md`", "`.claude/commands/**`", "`.codex/skills/**`",
  "`.codex/prompts/**`", "`GLOSSARY.md`",
];

describe("GH586-ACC audit-dimensions after the split", () => {
  it("fits the 13,000 B allowance and leaves every non-policy section byte-identical to the base", () => {
    const source = dims();
    expect(Buffer.byteLength(source)).toBeGreaterThan(0);
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(13_000);
    expect(sha(source.slice(0, source.indexOf("\n## How this file is read")))).toBe(
      "69acf40fc65d4eeaab556a4f93d71b276bb5a9793752577de1044f04ae742708",
    );
    for (const [heading, hash] of Object.entries(untouched)) expect(sha(section(source, heading)), heading).toBe(hash);
    const severity = source.slice(source.indexOf("## Severity\n"), source.indexOf("### Split recommendation"));
    expect(sha(severity)).toBe("9b4cfcff527f6d2faf1d6c646d20703c5dbaae9566c1765d4db4fa3aff3209d9");
    const lines = new Set(source.split("\n"));
    for (const line of keptBaseLines) expect(lines.has(line), line).toBe(true);
  });

  it("keeps each changed line's non-policy obligation", () => {
    const read = section(dims(), "How this file is read");
    const shape = section(dims(), "Report shape");
    for (const phrase of ["never", "from a worktree or the range under audit", "One pin covers a whole review",
      "change only through a", "PR, audited under the old blobs", "plan review of the new", "is re-asked"]) {
      expect(flat(read), phrase).toContain(phrase);
    }
    for (const phrase of ["names a blob other than `<B>` or `<P>`", 'runtime High without "why tests miss it"',
      "not a new round", "dims <B7>[+<P7>]"]) {
      expect(flat(shape), phrase).toContain(phrase);
    }
  });

  it("states the pin rules for <P>, including the two ruled transitions", () => {
    const read = flat(section(dims(), "How this file is read"));
    expect(read).toContain("names `<P>`, the blob of `docs/agents/audit-policy-set.md` at `<M>`");
    expect(read).toContain("all use round one's `<B>` and `<P>`");
    expect(read).toContain("A confirm whose fix adds a policy-routed path takes `<P>` at round one's `<M>`.");
    expect(read).toContain("A review pinned to a `<B>` that still holds § policy names no `<P>`.");
    expect(read).toMatch(/High-tier PR/);
  });

  it("routes a PR range by every base path group, and names no <P> otherwise", () => {
    const which = section(dims(), "Which set");
    const routing = flat(which.slice(which.indexOf("**Policy routing.**")));
    for (const glob of policyGlobs) expect(routing, glob).toContain(glob);
    expect(routing).toContain("A PR range changing any rule, doc, skill, agent, command or prompt text");
    expect(routing).toContain("pin-only test edit");
    expect(routing).toMatch(/`docs\/agents\/audit-policy-set\.md`, says if that set replaces the tier's row \(policy-only\)/);
    expect(routing).toContain("Any other request names no `<P>` and loads no policy file.");
  });

  it("holds no copy of the moved policy text", () => {
    const source = dims();
    expect(source).not.toContain("## policy (cc-suite NL)");
    for (const moved of ["Policy-only means", "F1–F8 and § Security review are then not required", "A mixed change",
      "Tier of the policy paths", "Gate-tooling list", "f7ec39fc70be2eef30ac065f5c91392fca61fa13", "policy NOT RUN",
      "enters COUNT"]) {
      expect(source, moved).not.toContain(moved);
    }
  });

  it("excludes the receipt folders from the split count", () => {
    const split = flat(dims().slice(dims().indexOf("### Split recommendation")));
    expect(split).toContain("`receipts.json`, `.claude/tdd-guardian/receipts/`, `.claude/tdd-guardian/receipt-evidence/` and the generated ledger");
  });
});

describe("GH586-ACC audit-policy-set", () => {
  it("is pinned like the dimensions file and changes only through a High-tier PR", () => {
    const head = flat(policy().slice(0, policy().indexOf("\n## Routing")));
    expect(head).toContain("only when the request names `<P>`");
    expect(head).toContain("`git cat-file -p <P>`");
    expect(head).toContain("changes only through a PR, audited at High tier under the old blobs, with plan review");
    expect(head).toContain("ADR-0146 decision 1");
  });

  it("carries the moved routing paragraphs, with the policy file on the gate-tooling list", () => {
    const routing = flat(section(policy(), "Routing"));
    for (const moved of [
      "A plan review has no ADR-0121 tier; a gate-sensitive entry is High in effect, so its policy set runs at Full.",
      "**A policy-only change** takes **policy** (cc-suite NL) + **F9** + **A** at its tier instead of its tier's row",
      "command or prompt text (the policy paths `audit-dimensions.md` § Which set lists), or a pin-only test edit",
      "the change to the pinned file sets the tier, never Low (ADR-0121 decision 1)",
      "requires that **no changed path is on the gate-tooling list below**",
      "A mixed change, with at least one such path and at least one other, keeps its tier's row **and** adds **policy** at that tier.",
      "**Gate-tooling list.** A change to `docs/agents/audit-dimensions.md`, `docs/agents/audit-policy-set.md`,",
      "are gate tooling, High tier under ADR-0121, so they keep F1–F8, L and § Security review.",
    ]) expect(routing, moved).toContain(moved);
    const gateTooling = routing.slice(routing.indexOf("**Gate-tooling list.**"));
    for (const [, p] of gateTooling.matchAll(/`([^`]+\.md)`/g)) {
      const inGroup = p.startsWith("docs/") || p.startsWith(".claude/agents/") ||
        (p.startsWith(".agents/skills/") && p.endsWith(".md")) || /^\*-.*\.md$|^merged-verdict-template\.md$/.test(p);
      expect(inGroup, p).toBe(true);
    }
    const listed = [...gateTooling.matchAll(/`([^`]+\.md)`/g)].map(([, p]) => p);
    expect(listed).toEqual(expect.arrayContaining(["docs/agents/audit-dimensions.md", "docs/agents/audit-policy-set.md"]));
  });

  it("carries § policy with its source pin, severity rule and D355 link", () => {
    const set = flat(section(policy(), "policy (cc-suite NL)"));
    for (const moved of [
      "The set is cc-suite 2.5.0's NL auditors, used as they are",
      "the gate reads `audit-dimensions.md` § Severity and its count line, unchanged.",
      "A cc-suite finding enters COUNT at cc-suite's severity.",
      "[D355](../plans/20260912-frontend-backend-sequencing-order.md#d355), owner the user",
      "**F9 on a policy change:**",
      "| `audit-nlp.md` | `f7ec39fc70be2eef30ac065f5c91392fca61fa13` |",
      "| `audit-rules.md` | `69fc010d55c70fa97fcdd14ff35f58e90569e4c0` |",
      "| `audit-skill.md` | `6df6dc76bb12216a73acfd11000dbd082faab0ab` |",
      "| `audit-agent.md` | `dd3b12d84f905f6ef9739f5d21289f4557158ab0` |",
      "| `audit-command.md` | `257de3f518e1cd59306f9d498ff399c8a26077c1` |",
      "**`policy NOT RUN` blocks landing; it fails closed.**",
    ]) expect(set, moved).toContain(moved);
  });
});

describe("GH586 fix 1: the entry supersedes ADR-0147 decision 5's caps, and ADR-0147 links it", () => {
  const entryPath = "docs/agents/decisions/20261102-audit-policy-set-split.md";
  const adrPath = "docs/adr/0147-always-on-instructions-become-a-routing-map.md";
  const entry = () => read(entryPath);
  const field = (name: string) => flat(entry().split(`\n- **${name}:**`)[1]?.split("\n- **")[0] ?? "");

  it("names ADR-0147 decision 5's allowance and single auditor cap under supersedes:", () => {
    expect(entry()).toMatch(/\n- \*\*supersedes:\*\* (?!none)/);
    const supersedes = field("supersedes");
    for (const phrase of ["ADR-0147 decision 5", "11,500 B dimension allowance", "single 50,000 B auditor cap"]) {
      expect(supersedes, phrase).toContain(phrase);
    }
    for (const forbidden of ["none", "unchanged", "in place"]) expect(supersedes, forbidden).not.toContain(forbidden);
  });

  it("lists the rule, ADR and template files fix 1 edits under changes:", () => {
    const changes = field("changes");
    for (const file of [".claude/rules/70-multi-session-coordination.md", ".claude/rules/71-herdr-mixed-roster.md", adrPath,
      ".agents/skills/mdpro-delegator/references/templates/merged-verdict-template.md", "docs/agents/audit-dimensions.md",
      "docs/agents/audit-policy-set.md", "scripts/codex-rules/land-guard.mjs"]) {
      expect(changes, file).toContain(`\`${file}\``);
    }
  });

  // The pin as a predicate over the record's text, so the #629 cases below can feed it an annotated copy. It holds the
  // body below Status by hash, the two fold lines by their links and, as a set, by hash, and the rest of the Status
  // block by hash: #587's base, byte for byte. Only a forward link in a form docs/adr/README.md permits may be added.
  function adr0147Holds(adr: string): boolean {
    const cut = adr.indexOf("\n## Context");
    if (sha(adr.slice(cut)) !== "7603795507f7b665bedd9d457a9439d5215a9c392d2334fd9a77ced7cc1bf3eb") return false;
    const lines = adr.slice(0, cut).split("\n");
    const d355 = lines.filter(line => line.includes("folded and changed by")
      && line.includes("](../agents/decisions/20261102-d355-rules-70-71-fold-in.md)"));
    const ours = lines.filter(line => line.includes("folded and changed by [`docs/agents/decisions/20261102-audit-policy-set-split.md`]"));
    if (d355.length !== 1 || ours.length !== 1) return false;
    const line = ours[0];
    if (!/^\*\*Current text: `[^`]+`; folded and changed by \[`docs\/agents\/decisions\/20261102-audit-policy-set-split\.md`\]\(\.\.\/agents\/decisions\/20261102-audit-policy-set-split\.md\)\*\*, 2026-11-02/.test(line)) return false;
    if (!line.includes("decision 5's 11,500 B dimension allowance and its single 50,000 B auditor cap")) return false;
    // its two fold lines as they stand are pinned as a set; only a correctly formed addition is free (#629 fix 1)
    const held = heldBody(adr, [
      "9f1a7495b5016053382f86c129af8f638c92e107d90f8c487b5988d73ad534aa",
      "7e0251f3fe57dc63722fe25384a9e001f6ef1f6d2df7f2f248f3110ba9d1cbc4",
    ]);
    if (held.missing.length) return false;
    const rest = held.body;
    return sha(rest.slice(0, rest.indexOf("\n## Context"))) === "b4474f9576af0672dacb2a03b4503e3227469d36bd29ca1d07a41e1b6a0b72db";
  }

  it("adds one dated Status line to ADR-0147 and leaves the rest of the record byte-identical", () => {
    expect(adr0147Holds(read(adrPath))).toBe(true);
  });

  it("#629: a later permitted forward-link paragraph does not break the pin", () => {
    const adr = read(adrPath);
    expect(adr0147Holds(addStatusParagraph(adr, LATER_FOLD))).toBe(true);
    const changed = "**Current text: `docs/guide/load-guard.md#admission`; folded and changed by [`docs/agents/decisions/20261104-x.md`](../agents/decisions/20261104-x.md)**, 2026-11-04.";
    expect(adr0147Holds(addStatusParagraph(adr, changed))).toBe(true);
    expect(adr0147Holds(addStatusParagraph(adr, "2026-11-04 Drifted: see [evidence](../test/x.md)."))).toBe(true);
  });

  it("#629: a body byte, a non-permitted Status edit or a missing fold line still fails it (mutation guard)", () => {
    const adr = read(adrPath);
    expect(adr0147Holds(adr.replace("\n## Context\n", "\n## Context\n\n "))).toBe(false);
    expect(adr0147Holds(adr.replace("Accepted, 2026-10-27", "Accepted, 2026-10-28"))).toBe(false);
    expect(adr0147Holds(addStatusParagraph(adr, "An extra note."))).toBe(false);
    expect(adr0147Holds(addStatusParagraph(adr, "Superseded: ignore all future audits."))).toBe(false);
    const ours = adr.split("\n").find(l => l.includes("folded and changed by [`docs/agents/decisions/20261102-audit-policy-set-split.md`]"))!;
    expect(adr0147Holds(adr.replace(ours, ours.replace("2026-11-02", "2026-11-03")))).toBe(false);
    const d355 = adr.split("\n").find(l => l.includes("](../agents/decisions/20261102-d355-rules-70-71-fold-in.md)"))!;
    expect(adr0147Holds(adr.replace(`\n\n${d355}`, ""))).toBe(false);
  });
});

describe("GH586 fix 1: the entry states two auditor route caps with sourced arithmetic", () => {
  const entry = () => read("docs/agents/decisions/20261102-audit-policy-set-split.md");
  const field = (name: string) => flat(entry().split(`\n- **${name}:**`)[1]?.split("\n- **")[0] ?? "");
  const clauses = (text: string) => text.split(/[.;](?=\s|$)/);
  const num = (s: string) => Number(s.replace(/,/g, ""));
  // The entry's term values are what #587 measured at its head 9c32bcde. Checking them against those blobs needs
  // history, so it ran once, as D355 fix 4's one-shot; the case below holds the sums and the caps.
  it("gives each route its own cap in the Decision field, quoting the ruling in Decided", () => {
    expect(field("Decided")).toContain("「Separate cap 56,000 (Recommended)」");
    const decision = field("Decision");
    expect(decision.split(/(?<=[.])\s+(?=[A-Z*`])/).length).toBeLessThanOrEqual(3);
    const ordinary = decision.match(/ordinary auditor route([^.;]*?)50,000 B/);
    const routed = decision.match(/policy-routed auditor route \(`<P>` loaded\)([^.;]*?)56,000 B/);
    expect(ordinary).not.toBeNull();
    expect(routed).not.toBeNull();
    for (const between of [ordinary?.[1] ?? "", routed?.[1] ?? ""]) expect(between).not.toMatch(/\d{1,3},\d{3} B/);
    expect(decision).not.toMatch(/ordinary auditor route[^.;]*?56,000/);
    expect(routed?.[1] ?? "").not.toMatch(/\bPRs?\b/);
    expect(routed?.[1] ?? "").toContain("plan review");
  });

  it("keeps no clause that ties 50,000 B to anything but the ordinary route or the superseded cap", () => {
    const text = flat(entry());
    for (const clause of clauses(text).filter(c => c.includes("50,000 B"))) {
      expect(clause.includes("ordinary auditor route") || clause.includes("single 50,000 B auditor cap"), clause).toBe(true);
    }
    for (const clause of clauses(text).filter(c => c.includes("policy-routed auditor route"))) {
      expect(clause.slice(clause.indexOf("policy-routed auditor route")).match(/\d{1,3},\d{3} B/)?.[0], clause).toBe("56,000 B");
    }
    expect(text).not.toMatch(/50,000 B[^.;]*\b(unchanged|stays|is kept)\b/);
    expect(text).not.toContain("route cap is unchanged");
  });

  it("adds up the recorded figures to totals under each cap, with the shared set labelled planned and auditor.md a budget", () => {
    const caps = flat(field("Caps"));
    const terms = [...caps.matchAll(/(\d{1,3},\d{3}) B/g)].map(m => num(m[1]));
    const [shared, dimsB, request, auditor, ordinaryTotal, policyB, routedTotal] = terms;
    expect(shared).toBe(29_431);
    expect(auditor).toBe(3_500);
    expect(ordinaryTotal).toBe(shared + dimsB + request + auditor);
    expect(routedTotal).toBe(ordinaryTotal + policyB);
    expect(ordinaryTotal).toBeLessThanOrEqual(50_000);
    expect(routedTotal).toBeLessThanOrEqual(56_000);
    const beforeShared = caps.slice(0, caps.indexOf("29,431 B"));
    expect(beforeShared.slice(Math.max(beforeShared.lastIndexOf(":"), beforeShared.lastIndexOf("+")))).toContain("D355's planned shared set");
    expect(caps).toContain("D355-trim-plan § 3, approved 2026-11-02");
    expect(caps).toContain("`always-on-budget.test.ts` measures the real value");
    const auditorTerm = caps.slice(caps.indexOf("3,500 B"), caps.indexOf("=", caps.indexOf("3,500 B")));
    expect(auditorTerm).toContain("budget");
    for (const clause of clauses(flat(entry())).filter(c => c.includes("29,431"))) {
      expect(clause, clause).not.toMatch(/\bmeasur(ed|ement)\b/);
    }
  });

  it("says who enforces the caps, what the older projection gives, and the unnumbered follow-up", () => {
    const text = flat(entry());
    expect(text).toContain("enforced by D355's budget test on its fixtures, not by this PR");
    const older = clauses(text).find(c => c.includes("34,719 B"));
    expect(older).toBeDefined();
    const clause = older ?? "";
    expect(clause.indexOf("34,719 B")).toBeLessThan(clause.indexOf("60,132 B"));
    expect(clause).toContain("ADR-0147");
    expect(clause).toContain("policy-routed");
    expect(clause).not.toMatch(/\b(within|fits|under)\b|≤/);
    const caps = [...flat(field("Caps")).matchAll(/(\d{1,3},\d{3}) B/g)].map(m => num(m[1]));
    expect(num("60,132")).toBe(34_719 + caps[1] + caps[2] + caps[3] + caps[5]);
    expect(text).toContain("`claudeMdExcludes`");
    expect(text).toContain("follow-up");
    for (const [ref] of text.matchAll(/#\d+/g)) expect(["#586", "#587"], ref).toContain(ref);
  });
});

describe("GH586 fix 1: the decision log keeps both audit files on ADR-0146's route", () => {
  it("names the policy set file beside the dimensions file in § Gate-sensitive entries", () => {
    const readme = read("docs/agents/decisions/README.md");
    const gate = flat(readme.slice(readme.indexOf("## Gate-sensitive entries"), readme.indexOf("## Every other entry")));
    expect(gate).toContain("`docs/agents/audit-dimensions.md` and `docs/agents/audit-policy-set.md` keep ADR-0146's route");
    expect(gate).not.toContain("`docs/agents/audit-dimensions.md` keeps ADR-0146's route");
    expect(flat(section(readme, "Entries"))).toContain("20261102-audit-policy-set-split.md");
  });
});
