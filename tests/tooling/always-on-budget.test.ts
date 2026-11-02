// @vitest-environment node
// D355, ADR-0147 decision 5: what each runtime and each role loads at the start of a session, capped as failing gates.
// Raising a cap changes a constant below in a commit whose body quotes the user's word (ADR-0147 d5).
// The checker is tests/tooling/rules-budget-lib.ts; its fixture self-tests are rules-budget-lib.test.ts.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bytesOf, claudeAlwaysOn, codexShared, directiveScanSet, frontmatterPaths, readBlocks, readDirectiveViolations, readRel,
  route, ROUTES, SCOPED_PATTERN_ALLOWLIST, trackedFiles, type Runtime,
} from "./rules-budget-lib";

const root = path.resolve(__dirname, "../..");

// ADR-0147 d5 ceilings (user: 「42 KB now (Recommended)」); the set caps below must stay under them.
const CLAUDE_SHARED_CEILING = 42_000;
const CODEX_SHARED_CEILING = 40_000;
// D355 ruling 1 Q4: the caps at the targets the trim met.
const CLAUDE_SHARED_CAP = 30_000;
const CODEX_SHARED_CAP = 28_000;
const FILE_CAPS: Record<string, number> = {
  "CLAUDE.md": 9_000,
  ".claude/rules/70-multi-session-coordination.md": 6_000,
  ".claude/rules/71-herdr-mixed-roster.md": 4_000,
  "AGENTS.md": 7_000,
};
// ADR-0147 d5 route caps (user: 「Accept, as failing gates (Recommended)」), both runtimes.
const IMPLEMENTOR_ROUTE_CAP = 48_000;
const DEVICE_ROUTE_CAP = 42_000;
const DELEGATOR_ROUTE_CAP = 50_000;
// D355 ruling 2 (user: 「Fable's split (Recommended)」): ADR-0147's values stand.
const AUDITOR_ROUTE_CAP = 50_000;
const DIMENSIONS_ALLOWANCE = 13_000; // ruling 2 amendment (user, #586: 「Pure move, allowance 13,000」)
const DIMENSIONS = "docs/agents/audit-dimensions.md";
const ROLE_CAPS = { implementor: IMPLEMENTOR_ROUTE_CAP, auditor: AUDITOR_ROUTE_CAP, device: DEVICE_ROUTE_CAP, delegator: DELEGATOR_ROUTE_CAP };

// A known exception asserts that its check is STILL failing, so it cannot outlive its cause: when the cause is fixed,
// this test fails until the entry is removed (D355 ruling 2). Every check not listed here must pass.
interface KnownException { check: string; issue: string; why: string }
const KNOWN_EXCEPTIONS: KnownException[] = [
  { check: "dimensions-allowance", issue: "anzchy/mdpro#586", why: "the cc-suite policy set moves to its own pinned file" },
];

// ADR-0147 d5 line targets, set at the targets the trim met (plan § 1).
const LINE_CAPS: Record<string, number> = {
  "CLAUDE.md": 150,
  "AGENTS.md": 115,
  ".claude/rules/70-multi-session-coordination.md": 95,
  ".claude/rules/71-herdr-mixed-roster.md": 65,
};
const ALWAYS_ON_RULE_LINES_CAP = 500;
const ALL_RULE_LINES_CAP = 1_285;

const RULES_AT_BASE = [
  "10-tdd.md", "12-feature-planning-gate.md", "20-logging-and-docs.md", "22-comment-maintenance.md", "25-careful-mode.md",
  "30-ui-consistency.md", "31-design-tokens.md", "32-component-patterns.md", "33-focus-indicators.md", "34-dark-theme.md",
  "40-version-bump.md", "41-keyboard-shortcuts.md", "50-codebase-conventions.md", "60-review-checklist.md",
  "70-multi-session-coordination.md", "71-herdr-mixed-roster.md",
].map((f) => `.claude/rules/${f}`);
const ALWAYS_ON_RULES = ["12-feature-planning-gate.md", "25-careful-mode.md", "60-review-checklist.md",
  "70-multi-session-coordination.md", "71-herdr-mixed-roster.md"].map((f) => `.claude/rules/${f}`);
const RULE_10_PATHS = ["src/**", "src-tauri/**", "tests/**", "scripts/**", ".claude/hooks/**", ".agents/skills/**/scripts/**", "vitest*.ts"];
const RULE_22_PATHS = ["src/**", "src-tauri/**", "tests/**", "scripts/**", ".claude/hooks/**", ".agents/skills/**/scripts/**"];
const RULE_50_PATHS = ["src/**", "src-tauri/**", "tests/**"];

const lines = (rel: string) => readRel(root, rel).replace(/\n$/, "").split("\n").length;
// a missing file lists nothing, so the case fails on its assertion rather than on a read error
const blocks = (rel: string) => (fs.existsSync(path.join(root, rel)) ? readBlocks(root, rel).entries : []);
const isException = (check: string) => KNOWN_EXCEPTIONS.some((e) => e.check === check);
const table = (rows: [string, number, number][]) => rows.map(([n, b, c]) => `${n.padEnd(28)} ${String(b).padStart(7)} / ${c}`).join("\n");

describe("always-on budget (live tree)", () => {
  it("the cap constants are the ruled values and under ADR-0147's ceilings (B18, B40)", () => {
    expect([CLAUDE_SHARED_CAP, CODEX_SHARED_CAP]).toEqual([30_000, 28_000]);
    expect(CLAUDE_SHARED_CAP).toBeLessThanOrEqual(CLAUDE_SHARED_CEILING);
    expect(CODEX_SHARED_CAP).toBeLessThanOrEqual(CODEX_SHARED_CEILING);
    expect(FILE_CAPS).toEqual({ "CLAUDE.md": 9_000, ".claude/rules/70-multi-session-coordination.md": 6_000,
      ".claude/rules/71-herdr-mixed-roster.md": 4_000, "AGENTS.md": 7_000 });
    expect(ROLE_CAPS).toEqual({ implementor: 48_000, auditor: 50_000, device: 42_000, delegator: 50_000 });
    expect(DIMENSIONS_ALLOWANCE).toBe(13_000);
  });

  it("the Claude always-on set is CLAUDE.md plus the five always-on rules, under its cap (B1, B2, B34)", () => {
    const set = claudeAlwaysOn(root);
    expect(set.errors).toEqual([]);
    expect(set.members.filter((m) => m.startsWith(".claude/rules/")).sort()).toEqual(ALWAYS_ON_RULES);
    expect(set.bytes, table(set.members.map((m) => [m, bytesOf(root, m), 0]))).toBeLessThanOrEqual(CLAUDE_SHARED_CAP);
  });

  it("the Codex shared set is AGENTS.md's read block, under its cap (B9, B10, B34)", () => {
    const set = codexShared(root);
    expect(set.errors).toEqual([]);
    expect(readBlocks(root, "AGENTS.md").entries).toEqual(["CLAUDE.md", ".claude/rules/12-feature-planning-gate.md",
      ".claude/rules/25-careful-mode.md", ".claude/rules/60-review-checklist.md"]);
    expect(set.bytes, table(set.members.map((m) => [m, bytesOf(root, m), 0]))).toBeLessThanOrEqual(CODEX_SHARED_CAP);
  });

  it("each shared file is under its own byte and line cap (B17, B33)", () => {
    for (const [f, cap] of Object.entries(FILE_CAPS)) expect(bytesOf(root, f), `${f} bytes`).toBeLessThanOrEqual(cap);
    for (const [f, cap] of Object.entries(LINE_CAPS)) expect(lines(f), `${f} lines`).toBeLessThanOrEqual(cap);
    const onLines = ALWAYS_ON_RULES.reduce((n, f) => n + lines(f), 0);
    expect(onLines, "always-on rule lines").toBeLessThanOrEqual(ALWAYS_ON_RULE_LINES_CAP);
    const all = trackedFiles(root).filter((f) => f.startsWith(".claude/rules/") && f.endsWith(".md"));
    expect(all.reduce((n, f) => n + lines(f), 0), ".claude/rules lines").toBeLessThanOrEqual(ALL_RULE_LINES_CAP);
  });

  it("every route, on both runtimes, fits its cap; only a named known exception may not, and it must still fail (B2, B20, B31, B36)", () => {
    const rows: [string, number, number][] = [];
    const over: string[] = [];
    for (const name of Object.keys(ROUTES)) {
      for (const runtime of ["claude", "codex"] as Runtime[]) {
        const r = route(root, name, runtime);
        expect(r.errors, `${name} (${runtime})`).toEqual([]);
        const cap = ROLE_CAPS[ROUTES[name].role];
        rows.push([`${name} (${runtime})`, r.bytes, cap]);
        if (r.bytes > cap) over.push(`${name} (${runtime})`);
      }
    }
    const excepted = over.filter((o) => isException(`route:${o}`));
    expect(over.filter((o) => !excepted.includes(o)), table(rows)).toEqual([]);
    for (const e of KNOWN_EXCEPTIONS.filter((x) => x.check.startsWith("route:"))) {
      expect(over, `${e.check} now fits: remove the known exception (${e.issue})`).toContain(e.check.slice("route:".length));
    }
  });

  it("the auditor routes carry the dimension file, within its allowance or as the named exception (B21, B32, B36)", () => {
    for (const name of ["auditor-audit", "auditor-confirm", "auditor-challenge", "auditor-plan"]) {
      for (const runtime of ["claude", "codex"] as Runtime[]) expect(route(root, name, runtime).members).toContain(DIMENSIONS);
    }
    const size = bytesOf(root, DIMENSIONS);
    if (isException("dimensions-allowance")) {
      expect(size, `${DIMENSIONS} now fits ${DIMENSIONS_ALLOWANCE}: remove the known exception (anzchy/mdpro#586)`).toBeGreaterThan(DIMENSIONS_ALLOWANCE);
    } else {
      expect(size).toBeLessThanOrEqual(DIMENSIONS_ALLOWANCE);
    }
  });

  it("rule files: the inventory is the one at db04d826, and paths: scoping is exact (B19, B41)", () => {
    expect(trackedFiles(root).filter((f) => f.startsWith(".claude/rules/")).sort()).toEqual(RULES_AT_BASE);
    expect(frontmatterPaths(readRel(root, ".claude/rules/10-tdd.md"))).toEqual(RULE_10_PATHS);
    expect(frontmatterPaths(readRel(root, ".claude/rules/22-comment-maintenance.md"))).toEqual(RULE_22_PATHS);
    expect(frontmatterPaths(readRel(root, ".claude/rules/50-codebase-conventions.md"))).toEqual(RULE_50_PATHS);
    const union = new Set<string>([...RULE_10_PATHS, ...RULE_22_PATHS, ...RULE_50_PATHS]);
    for (const f of RULES_AT_BASE) for (const p of frontmatterPaths(readRel(root, f)) ?? []) union.add(p);
    expect([...SCOPED_PATTERN_ALLOWLIST].sort()).toEqual([...union].sort());
    for (const p of ["docs/adr/**", "docs/plans/**", ".claude/**", "docs/specs/**", ".agents/**"]) {
      expect(SCOPED_PATTERN_ALLOWLIST).not.toContain(p);
    }
  });

  it("no other file either runtime loads every session exists (B42)", () => {
    const loaded = trackedFiles(root).filter((f) => /(^|\/)(CLAUDE|AGENTS)(\.local|\.override)?\.md$/.test(f));
    expect(loaded.sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });

  it("the role files' read blocks name what the ruling says (B34)", () => {
    const impl = blocks("docs/agents/implementor.md");
    expect(impl).toContain(".claude/rules/10-tdd.md");
    expect(impl).not.toContain(".claude/rules/22-comment-maintenance.md");
    expect(impl).not.toContain(".claude/rules/50-codebase-conventions.md");
    expect(blocks("docs/agents/auditor.md")).toContain(DIMENSIONS);
    for (const def of Object.values(ROUTES)) {
      if (def.start.length < 2) continue;
      expect(blocks(def.start[1]), `${def.start[1]} names its role file`).toContain(def.start[0]);
    }
    expect(blocks(".agents/skills/mdpro-delegator/SKILL.md"))
      .toContain(".agents/skills/mdpro-delegator/references/guide.md");
    const agents = readRel(root, "AGENTS.md");
    for (const rule of ["10-tdd", "22-comment-maintenance", "50-codebase-conventions"]) expect(agents).toContain(`${rule}.md`);
    for (const p of [...RULE_10_PATHS, ...RULE_22_PATHS, ...RULE_50_PATHS]) expect(agents).toContain(`\`${p}\``);
    expect(readRel(root, "CLAUDE.md")).toContain("scripts/heavy-lock.sh");
  });

  it("no mandatory read hides outside a read block, and every repo link there carries a live anchor (B12–B14, B23, B30, B39)", () => {
    const violations = directiveScanSet(root).flatMap((f) => readDirectiveViolations(root, f));
    expect(violations.map((v) => `${v.where} ${v.what}`)).toEqual([]);
  });

  it("the Claude delegator's docs-only step runs both tests and stops on red (B43, ADR-0147 d5)", () => {
    const skill = readRel(root, ".agents/skills/mdpro-delegator/SKILL.md");
    const step = skill.split("\n").find((l) => l.includes("always-on-budget.test.ts") && l.includes("rule-citations.test.ts"));
    expect(step, "SKILL.md names both tests in one command").toBeDefined();
    expect(skill).toMatch(/stop on red/i);
    expect(skill).toMatch(/commit body/i);
  });

  it("the history file and the section map exist (ADR-0147 d2, d4)", () => {
    expect(fs.existsSync(path.join(root, "docs/reference/20261027-rules-70-71-history.md"))).toBe(true);
  });
});
