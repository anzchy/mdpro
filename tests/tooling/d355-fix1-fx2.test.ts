// @vitest-environment node
// D355 fix 1, fx2: see d355-fix1-lib.ts for the shared scanner.
import { describe, expect, it } from "vitest";
import {
  read, flat, sha, ISSUE_570, rawSection, section, sentences, LA, R71, R12, IMPL, SKILL, PROMPT, FOLD_IN, BRIEF_T, ADR, adrFiles, anchorExists,
} from "./d355-fix1-lib";
describe("FX-2: the pre-go-live TDD law (ruling 1 R1)", () => {
  const impl = () => rawSection(read(IMPL), "Matrix and attack");
  // re-attack gap 6: only the assignment line counts, and G1 pins prompt.sh
  const goLive = () => /^\s*tdd="with \\\$tdd-guardian:tdd-guardian-workflow"/m.test(read(PROMPT));

  it("B1: implementor.md names both runtimes' current method and T-02's go-live", () => {
    const s = flat(impl());
    for (const p of ["go-live", "T-02", ISSUE_570, "ADR-0161", "$tdd-guardian:tdd-guardian-workflow", "jack-tdd-workflow"]) {
      expect(s, p).toContain(p);
    }
    expect(s).not.toMatch(/on both runtimes, is the `jack-tdd-workflow`/);
  });

  it("B2: implementor.md sends Claude to the skill's steps by path#anchor, with a fresh attacker", () => {
    const s = flat(impl());
    for (const a of ["1-design-the-test-matrix", "2-have-the-matrix-attacked", "3-amend-the-matrix", "5-cycles"]) {
      expect(s, a).toContain(`${SKILL}#${a}`);
      expect(anchorExists(SKILL, a), a).toBe(true);
    }
    for (const p of ["fresh", "ATTACK-NOT-RUN", "stop"]) expect(s, p).toContain(p);
  });

  it("B2-skill: the skill still carries the four steps", () => {
    const t = read(SKILL);
    for (const p of ["boundary (empty, max, CJK)", "lifecycle and timing", "invalid input", "platform"]) {
      expect(section(t, "1. Design the test matrix"), p).toContain(p);
    }
    for (const p of ["never a fork", "ATTACK-NOT-RUN", "matrix-attack-prompt.md", "only the attack prompt, the brief and the matrix", "verbatim"]) {
      expect(section(t, "2. Have the matrix attacked"), p).toContain(p);
    }
    for (const p of ["counter-proof", "NEEDS RULING", "still open after the re-attack"]) expect(section(t, "3. Amend the matrix"), p).toContain(p);
    expect(section(t, "1. Design the test matrix")).toContain("every caller or entry path");
    for (const a of ["1-design-the-test-matrix", "2-have-the-matrix-attacked", "3-amend-the-matrix", "5-cycles"]) expect(anchorExists(SKILL, a), a).toBe(true);
  });

  it("B3: rule 71 § Briefs names go-live and both runtimes", () => {
    const s = section(read(R71), "Briefs and self-acceptance");
    for (const p of ["go-live", "jack-tdd-workflow", "tdd-guardian", "Claude"]) expect(s, p).toContain(p);
  });

  it("B4: AGENTS.md's skill row says the brief names the skill and keeps tdd-guardian until go-live", () => {
    const row = read("AGENTS.md").split("\n").find((l) => l.startsWith("| A skill"));
    expect(row).toBeTruthy();
    const cells = row!.split("|").map((c) => c.trim());
    expect(cells[2]).toMatch(/the brief names (the|which) skill/);
    if (row!.includes("jack-tdd-workflow")) {
      expect(row).toContain("tdd-guardian");
      expect(row).toContain("go-live");
    }
  });

  it("B5: while prompt.sh still sends Codex tdd-guardian, ADR-0161 is the base bytes with no Current text (T-02 flips this)", () => {
    const rel = ADR("0161");
    if (goLive()) {
      // the accepted ADR's bytes at 22ffe5ea (blob 53ddd8b4)
      expect(sha(read(rel))).toBe("b4a4cc54b9c2f6259cd35f3fc28b83d47db09a8aa92ed200a619d0e3c6e1d19d");
      expect(read(rel)).not.toContain("**Current text:");
    } else {
      expect(read(rel)).toContain("**Current text:");
    }
  });

  it("B6: the fold-in entry's ADR count matches the ADRs that link it, and 0161 says it waits for T-02", () => {
    const entry = read(FOLD_IN);
    const linking = adrFiles().filter((f) => read(`docs/adr/${f}`).includes("20261102-d355-rules-70-71-fold-in.md")).length;
    const rows = entry.split("\n").filter((l) => /^\| 0\d{3} \|/.test(l));
    expect(rows.filter((l) => !/no Status line until T-02/.test(l)).length).toBe(linking);
    expect(rows.find((l) => l.startsWith("| 0161 |"))).toMatch(/no Status line until T-02/);
  });

  it("B7: § Confirm handoff defines its step and its three Highs", () => {
    const s = section(read(LA), "Confirm handoff");
    for (const bad of ["The plugin runs", "all three Highs above", "The step applies"]) expect(s, bad).not.toContain(bad);
    for (const p of ["implementor.md#matrix-and-attack", "M3b H1", "D290 H1", "D290 H2", "matrix-attack step", "fix brief says so"]) {
      expect(s, p).toContain(p);
    }
  });

  it("B8: the brief template keeps Codex on tdd-guardian and points Claude at implementor.md", () => {
    const t = flat(read(BRIEF_T));
    expect(t).toContain("$tdd-guardian:tdd-guardian-workflow");
    expect(t).toContain("implementor.md#matrix-and-attack");
    expect(t).not.toContain("rule 71 § Briefs");
  });

  it("B9: implementor.md and rule 71 say Codex keeps tdd-guardian until go-live and jack-tdd-workflow applies from it", () => {
    for (const [f, raw] of [[IMPL, impl()], [R71, rawSection(read(R71), "Briefs and self-acceptance")]] as const) {
      const xs = sentences(raw);
      expect(xs.some((x) => x.includes("until") && /go-live|t-02/.test(x) && x.includes("codex") && x.includes("tdd-guardian")), f).toBe(true);
      expect(xs.some((x) => x.includes("from") && x.includes("go-live") && x.includes("jack-tdd-workflow")), f).toBe(true);
      expect(xs.filter((x) => x.includes("tdd-guardian") && /retire|supersed|replaced|no longer/.test(x)), f).toEqual([]);
      // re-attack gap 5: the until-sentence is Codex's alone; Claude runs the skill's steps now, not from go-live
      for (const x of xs.filter((y) => y.includes("until") && y.includes("tdd-guardian"))) expect(x, f).not.toMatch(/\b(claude|both)\b/);
      const claude = xs.filter((x) => x.includes("claude") && x.includes("fresh") && x.includes("attack-not-run"));
      expect(claude.length, f).toBeGreaterThan(0);
      for (const x of claude) expect(x, f).not.toMatch(/\b(from|after|once)\b[^.]*go-live/);
    }
  });

  it("B9b: implementor.md's Claude sentence links the skill's attack step", () => {
    const xs = flat(impl()).split(/(?<=[.;])\s+/).filter((x) => x.includes("Claude") && x.includes("ATTACK-NOT-RUN"));
    expect(xs.some((x) => x.includes(`${SKILL}#2-have-the-matrix-attacked`) && x.includes("fresh"))).toBe(true);
  });

  it("B10: rule 12 and implementor.md § Gated items do not make jack-tdd-workflow every runtime's method before go-live", () => {
    const bullet = flat(read(R12)).match(/\*\*Implementation\*\*[^]*?(?= - \*\*Never)/)?.[0] ?? "";
    expect(bullet).toContain("go-live");
    expect(section(read(IMPL), "Gated items")).toContain("go-live");
  });
});

