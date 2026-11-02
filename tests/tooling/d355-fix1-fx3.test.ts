// @vitest-environment node
// D355 fix 1, fx3: see d355-fix1-lib.ts for the shared scanner.
import { describe, expect, it } from "vitest";
import {
  read, exists, rawSection, normalise, sentences, R70, R71,
} from "./d355-fix1-lib";
describe("FX-3: AGENTS.md binds rules 70 and 71 and maps each role to its files (ruling 1 R3)", () => {
  const text = () => read("AGENTS.md");
  const every = () => rawSection(text(), "Every session (Codex)");

  it("C1: the conditional wording is gone", () => {
    expect(text()).not.toContain("when your request lists them");
    expect(text()).not.toContain("the role file your brief or request names");
  });

  it("C2: rules 70 and 71 bind every herdr session, unconditionally", () => {
    expect(normalise(every()).s).toMatch(/(^|\. )rules 70 and 71 bind every herdr session\.( |$)/);
  });

  it("C3: a role table maps each role to its role file and rules 70 and 71, all existing", () => {
    const rows = every().split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Role") && !l.startsWith("|---"))
      .map((l) => l.split("|").map((c) => c.trim()));
    const fileOf = (role: string) => rows.find((r) => r[1].includes(role))?.[2] ?? "";
    expect(fileOf("implementor")).toContain("`docs/agents/implementor.md`");
    expect(fileOf("auditor")).toContain("`docs/agents/auditor.md`");
    expect(fileOf("device tester")).toContain("`docs/agents/device-tester.md`");
    expect(fileOf("herdr-delegator")).toContain("`.agents/skills/mdpro-delegator/SKILL.md`");
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect(r[2], r[1]).toContain(`\`${R70}\``);
      expect(r[2], r[1]).toContain(`\`${R71}\``);
      for (const m of r[2].matchAll(/`([^`]+\.md)`/g)) expect(exists(m[1]), m[1]).toBe(true);
    }
  });

  it("C4: the role table is outside the read block", () => {
    const e = every();
    const block = e.slice(e.indexOf("<!-- read-every-session:begin -->"), e.indexOf("<!-- read-every-session:end -->"));
    for (const f of ["device-tester.md", "implementor.md", "70-multi-session", "71-herdr"]) expect(block, f).not.toContain(f);
  });

  it("C5: no sentence about the role file or rules 70/71 is conditional", () => {
    const bad = sentences(every()).filter((x) => /role file|\b70\b|\b71\b/.test(x) && /\b(when|if|unless|except|only|apart from|decides|request|brief)\b|names them/.test(x));
    expect(bad).toEqual([]);
  });
});

