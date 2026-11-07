// @vitest-environment node
// D355 fix 1, fx2: current T570 go-live law. The 2026-11-02 fold-in remains a historical record.
import { describe, expect, it } from "vitest";
import {
  read, flat, sha, rawSection, section, LA, R71, R12, IMPL, SKILL, PROMPT, FOLD_IN, BRIEF_T, ADR, adrFiles, anchorExists,
} from "./d355-fix1-lib";

describe("FX-2: the common jack-tdd-workflow law after T570", () => {
  const impl = () => rawSection(read(IMPL), "Matrix and attack");

  it("routes both runtimes through the skill in active standing text and the brief template", () => {
    const texts = [impl(), section(read(R71), "Briefs and self-acceptance"), read(R12), read("AGENTS.md"), read(BRIEF_T), read(PROMPT)];
    expect(texts.map((text) => ({ skill: text.includes("jack-tdd-workflow"), oldRoute: text.includes("tdd-guardian:tdd-guardian-workflow") })))
      .toEqual(Array(texts.length).fill({ skill: true, oldRoute: false }));
    expect(flat(impl())).toContain("both runtimes");
    expect(section(read(R71), "Briefs and self-acceptance")).toContain("both runtimes");
  });

  it("keeps the skill's matrix, fresh attack, amendment and cycle sections reachable", () => {
    const t = read(SKILL);
    for (const p of ["boundary (empty, max, CJK)", "lifecycle and timing", "invalid input", "platform"]) {
      expect(section(t, "1. Design the test matrix"), p).toContain(p);
    }
    for (const p of ["never a fork", "ATTACK-NOT-RUN", "matrix-attack-prompt.md", "only the attack prompt, the brief and the matrix", "verbatim"]) {
      expect(section(t, "2. Have the matrix attacked"), p).toContain(p);
    }
    for (const p of ["counter-proof", "NEEDS RULING", "still open after the re-attack"]) expect(section(t, "3. Amend the matrix"), p).toContain(p);
    for (const a of ["1-design-the-test-matrix", "2-have-the-matrix-attacked", "3-amend-the-matrix", "5-cycles"]) expect(anchorExists(SKILL, a), a).toBe(true);
  });

  it("keeps ADR-0161's accepted body byte-for-byte while the active route changes", () => {
    const adr = read(ADR("0161"));
    expect({ accepted: adr.includes("**Status**: Accepted"), sha: sha(adr) })
      .toEqual({ accepted: true, sha: "b4a4cc54b9c2f6259cd35f3fc28b83d47db09a8aa92ed200a619d0e3c6e1d19d" });
  });

  it("keeps the historical fold-in count and the confirm-handoff evidence rule", () => {
    const entry = read(FOLD_IN);
    const linking = adrFiles().filter((f) => read(`docs/adr/${f}`).includes("20261102-d355-rules-70-71-fold-in.md")).length;
    const rows = entry.split("\n").filter((l) => /^\| 0\d{3} \|/.test(l));
    expect(rows.filter((l) => !/no Status line until T-02/.test(l)).length).toBe(linking);
    const confirm = section(read(LA), "Confirm handoff");
    for (const p of ["M3b H1", "D290 H1", "D290 H2", "fix brief says so"]) expect(confirm, p).toContain(p);
  });

  it("keeps the new-seam stop in rule 12 and common cycles in rule 71", () => {
    expect(section(read(R12), "From tickets to landing")).toContain("new seam");
    expect(section(read(R71), "Briefs and self-acceptance")).toContain("every implementor item");
  });
});
