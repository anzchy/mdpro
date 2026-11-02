// @vitest-environment node
// GH586-ACC: the policy set moves out of audit-dimensions.md into audit-policy-set.md (ruling 1: pure move,
// dimension allowance 13,000 B). Base for the byte-identity checks: db04d826:docs/agents/audit-dimensions.md.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
