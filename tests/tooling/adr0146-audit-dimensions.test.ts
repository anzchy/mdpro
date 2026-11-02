// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const dimensionsPath = path.join(root, "docs/agents/audit-dimensions.md");
const bytes = () => fs.existsSync(dimensionsPath) ? fs.readFileSync(dimensionsPath) : Buffer.alloc(0);
const text = () => bytes().toString("utf8");

function section(source: string, heading: string): string {
  const start = source.indexOf(`## ${heading}\n`);
  if (start < 0) return "";
  const end = source.indexOf("\n## ", start + 3);
  return source.slice(start, end < 0 ? undefined : end);
}

describe("ADR-0146 reviewed audit dimensions", () => {
  it("publishes the authorized fix 2 dimensions blob byte for byte", () => {
    expect(createHash("sha256").update(bytes()).digest("hex")).toBe(
      // ADR-0146 fix 2 authorizes the single challenge-shape line deviation; ADR0165-WI1 rewords F9
      // (decision-log and feature-local decisions); GH586 moves the policy set (cc-suite NL) into
      // docs/agents/audit-policy-set.md, pinned below, pending both auditors' plan review of both blobs.
      "5648be3ff6890838ed07b0bfb8432a1eadcd3ff2ad25edc80a9e0c7aefe8860f",
    );
  });

  it("publishes the GH586 policy set blob byte for byte", () => {
    const policyPath = path.join(root, "docs/agents/audit-policy-set.md");
    const policy = fs.existsSync(policyPath) ? fs.readFileSync(policyPath) : Buffer.alloc(0);
    expect(createHash("sha256").update(policy).digest("hex")).toBe(
      // GH586 moves § policy (cc-suite NL), its source pin and the policy-only / mixed / gate-tooling routing here
      // verbatim except for pointers, pending both auditors' plan review of this blob.
      "f045a7efd9cd6d0457ed33c964781e92153a646d2071a08bc6a1c4a057a52a6d",
    );
  });

  it("GH586: the routing paragraph also names <P> for a gate-sensitive entry's plan review", () => {
    const which = section(text(), "Which set").replace(/\s+/g, " ");
    const routing = which.slice(which.indexOf("**Policy routing.**"), which.indexOf("Any other request names no `<P>`"));
    expect(routing).toContain("as does a gate-sensitive entry's plan review");
    expect(routing).toContain("The request names `<P>`");
  });

  it("publishes every set, evidence rule, and report line", () => {
    const document = text();
    const expected: Record<string, string[]> = {
      "mini (M1–M5)": ["M1.", "M2.", "M3.", "M4.", "M5."],
      "full (F1–F9)": ["F1.", "F2.", "F3.", "F4.", "F5.", "F6.", "F7.", "F8.", "F9."],
      "L. Lifecycle & concurrency (every tier)": ["five cases", "Platform order"],
      "A. Evidence proves each AC (every tier)": ["PROVED", "NOT PROVED", "WRONG"],
      "plan (P1–P5)": ["Internal Consistency", "Risk & Sequencing"],
      "Severity": ["Critical", "High", "Medium", "Low", "Evidence for a blocker"],
      "Security review (High tier, both auditors)": ["secrets", "IPC trust boundary", "auth on the MCP HTTP routes"],
      "Report shape": ["COVERAGE", "AC        AC-1", "SECURITY", "re-asks"],
    };
    for (const [heading, terms] of Object.entries(expected)) {
      const content = section(document, heading);
      expect(content, heading).not.toBe("");
      for (const term of terms) expect(content, `${heading}: ${term}`).toContain(term);
    }
  });
});

describe("ADR-0146 Opus auditor procedure", () => {
  const auditor = () => fs.readFileSync(path.join(root, ".claude/agents/mdpro-fable-auditor.md"), "utf8");

  it("reads the pinned dimension blob and echoes it in the report", () => {
    const source = auditor();
    const frontmatter = source.slice(0, source.indexOf("\n---\n", 4));
    const input = section(source, "Input (any missing item → BLOCKED)");
    for (const fragment of [frontmatter, input]) {
      expect(fragment).toContain("docs/agents/audit-dimensions.md");
      expect(fragment).toContain("<B>");
    }
    for (const name of ["Dimensions", "Severity", "Output"]) {
      const content = section(source, name);
      expect(content, name).toContain("git cat-file -p <B>");
      expect(content, name).toContain("echo <B>");
    }
  });

  it("GH586: reads the policy pin <P> only when the request is policy-routed", () => {
    const source = auditor();
    const flat = (text: string) => text.replace(/\s+/g, " ");
    const input = flat(section(source, "Input (any missing item → BLOCKED)"));
    const bullet = input.slice(input.indexOf("- policy pin:"), input.indexOf("- `confirm`:"));
    expect(bullet).toContain("only when § Which set routes the request to the policy set");
    expect(bullet).toContain("git rev-parse <M>:docs/agents/audit-policy-set.md");
    expect(bullet).toContain("A policy-routed request without `<P>` → BLOCKED");
    expect(bullet).toContain("A review pinned to a `<B>` that still holds § policy names no `<P>`.");
    expect(bullet).toContain("A confirm whose fix adds a policy-routed path takes `<P>` at round one's `<M>`.");
    for (const name of ["Dimensions", "Output"]) {
      const content = flat(section(source, name));
      expect(content, name).toContain("When the request names `<P>`");
      for (const sentence of content.split(/(?<=\.)\s+/)) {
        if (/<P>|audit-policy-set/.test(sentence)) expect(sentence, `${name}: ${sentence}`).toContain("When the request names `<P>`");
      }
    }
    expect(flat(section(source, "Dimensions"))).toContain("git cat-file -p <P>");
    expect(flat(section(source, "Output"))).toContain("echo <P>");
  });

  it("does not redefine the shared dimensions or skip test files", () => {
    const source = auditor();
    const shared = [
      source.slice(0, source.indexOf("\n---\n", 4)),
      section(source, "Input (any missing item → BLOCKED)"),
      section(source, "Dimensions"),
      section(source, "Severity"),
      section(source, "Output"),
    ].join("\n");
    expect(shared).not.toMatch(/skip test files|mini's five|full's nine|Medium and Low.*counted only/i);
    expect(section(source, "Dimensions")).not.toMatch(/^\d+\. Logic & Correctness/m);
    expect(section(source, "Severity")).not.toMatch(/^Critical: data loss/m);
  });

  it("retains all four modes, read barriers, and procedure obligations", () => {
    const source = auditor();
    const preInput = source.slice(source.indexOf("\n---\n", 4), source.indexOf("\n## Input"));
    const procedure = section(source, "Procedure by mode");
    for (const mode of ["`audit`", "`confirm`", "`challenge`", "`plan`"]) {
      expect(preInput).toContain(mode);
    }
    for (const phrase of [
      "any other auditor's verdict", "completed", "one finding", "every acquirer", "every writer and deleter",
      "every caller", "window, close and quit", "hard", "PARTIAL", "Regressions", "No repeats",
      "Pre-existing", "all three", "counter-proof", "READY",
    ]) {
      expect(`${preInput}\n${procedure}`, phrase).toContain(phrase);
    }
  });
});

describe("ADR-0146 delegator templates", () => {
  const template = (name: string) => fs.readFileSync(
    path.join(root, `.agents/skills/mdpro-delegator/references/templates/${name}-template.md`), "utf8",
  );

  it("binds each request to one master SHA and its dimension blob for the whole review", () => {
    for (const name of ["audit-request", "confirm-request", "challenge-request", "plan-review-request"]) {
      const source = template(name);
      expect(source, name).toContain("<M>");
      expect(source, name).toContain("<B>");
      expect(source, name).toContain("git rev-parse <M>:docs/agents/audit-dimensions.md");
      expect(source, name).toContain("equals <B>");
      expect(source, name).toContain("git cat-file -p <B>");
      expect(source, name).toContain("round one, its challenges, the confirm and the confirm's challenges");
    }
  });

  it("GH586: names <P> only when § Which set routes the range to the policy set", () => {
    const sentences = (source: string) => source.replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[-*A-Z`<])/);
    for (const name of ["audit-request", "confirm-request", "challenge-request", "plan-review-request"]) {
      const source = template(name);
      const flat = source.replace(/\s+/g, " ");
      for (const phrase of [
        "git rev-parse <M>:docs/agents/audit-policy-set.md", "equals <P>", "git cat-file -p <P>", "echo `<P>`",
        "names no `<P>`", "for `<P>` as for `<B>`",
      ]) expect(flat, `${name}: ${phrase}`).toContain(phrase);
      for (const sentence of sentences(source)) {
        if (!/audit-policy-set\.md|git cat-file -p <P>/.test(sentence)) continue;
        expect(sentence, `${name}: ${sentence}`).toMatch(/§ Which set routes|[Ww]hen the request names `<P>`/);
      }
    }
  });

  it("GH586: confirm and challenge carry ruling 1's two <P> transitions", () => {
    for (const name of ["confirm-request", "challenge-request"]) {
      const flat = template(name).replace(/\s+/g, " ");
      expect(flat, name).toContain("A confirm whose fix adds a policy-routed path takes `<P>` at round one's `<M>`.");
      expect(flat, name).toContain("A review pinned to a `<B>` that still holds § policy names no `<P>`.");
    }
  });

  it("GH586: a plan review names <P> for a decision-log entry, never for an ADR", () => {
    const flat = template("plan-review-request").replace(/\s+/g, " ");
    const mode = flat.slice(flat.indexOf("- **Mode:**"), flat.indexOf("- **Read also:**"));
    const split = mode.indexOf("for a decision-log entry");
    expect(split).toBeGreaterThan(0);
    expect(mode.slice(0, split)).not.toMatch(/<P>|audit-policy-set/);
    expect(mode.slice(split)).toContain("`<P>`");
    expect(flat).toContain("An ADR review names no `<P>`.");
  });

  it("requires coverage, per-AC verdicts and cited acceptance in audit and confirm", () => {
    for (const name of ["audit-request", "confirm-request"]) {
      const source = template(name);
      expect(source, name).toContain("COVERAGE");
      expect(source, name).toContain("AC line for every AC");
      expect(source, name).toContain("ADR-0146 decision 4 acceptance");
      expect(source, name).toContain("cite");
    }
  });

  it("does not carry the one-time bootstrap exception into future audit requests", () => {
    expect(template("audit-request")).not.toMatch(/This implementing PR uses ADR-0146's\s+bootstrap exception/);
  });

  it("carries the challenge, plan and merged verdict obligations", () => {
    const challenge = template("challenge-request");
    expect(challenge).toMatch(/^# Request: challenge,.*High or lifecycle Medium/m);
    expect(challenge).toContain("trace this");
    expect(challenge).toContain("untraced lifecycle Medium");
    expect(challenge).toContain("`hard`");

    const plan = template("plan-review-request");
    expect(plan).toContain("plan set");
    expect(plan).toContain("git cat-file -p <B>");

    const merged = template("merged-verdict");
    expect(merged).toContain("gpt-auditor");
    expect(merged).toContain("opus-auditor");
    expect(merged).toContain("COVERAGE");
    expect(merged).toContain("AC verdict");
    expect(merged).toContain("Mediums listed one line each");
    expect(merged).not.toContain("Mediums counted only");
  });

  it("keeps an untraced lifecycle challenge listed as Medium without weakening High refutation", () => {
    const challenge = template("challenge-request");
    const procedure = fs.readFileSync(path.join(root, ".claude/agents/mdpro-fable-auditor.md"), "utf8");
    const reportShape = section(text(), "Report shape");
    for (const source of [challenge, procedure, reportShape]) {
      expect(source).toContain("UNTRACED");
      for (const token of ["CONFIRMED", "REFUTED"]) expect(source).toContain(token);
    }
    expect(reportShape).toContain("CONFIRMED|REFUTED|UNTRACED");
    expect(challenge).toContain("CONFIRMED|REFUTED|UNTRACED");
    for (const source of [challenge, procedure]) {
      expect(source).toContain("stays a listed Medium");
      expect(source).toContain("reproduction or a counter-proof");
    }
    expect(reportShape).toContain("trace this");
    expect(reportShape).toContain("lifecycle Medium");
    expect(reportShape).toContain("listed Medium");
    expect(challenge).toContain("neither a trace nor a counter-proof");
    expect(challenge).toContain("merge verdict");
  });
});

describe("ADR-0146 delegator step 7", () => {
  const step7 = () => {
    const source = fs.readFileSync(path.join(root, ".agents/skills/mdpro-delegator/SKILL.md"), "utf8");
    const start = source.indexOf("\n7. **Record the two auditor verdicts**");
    const end = source.indexOf("\n8. **Land**", start);
    return start >= 0 && end > start ? source.slice(start, end) : "";
  };

  it("re-asks all five incomplete report forms in the same round", () => {
    const source = step7();
    expect(source).not.toBe("");
    expect(source).toContain("same round");
    for (const phrase of [
      "no COVERAGE line",
      "dimension skipped without a reason",
      "AC with no verdict",
      "blob other than <B>",
      "traced runtime High without why tests miss it",
    ]) {
      expect(source, phrase).toContain(phrase);
    }
  });

  it("GH586: re-asks a wrong or missing policy pin, except for a review pinned before the split", () => {
    const source = step7().replace(/\s+/g, " ");
    const reask = source.slice(source.indexOf("Re-ask checks:"));
    expect(reask).toContain("a blob other than <B> or <P>");
    expect(reask).toContain("a policy-routed report without <P>");
    expect(reask).toContain("a review pinned to a <B> that still holds § policy names no <P>");
  });

  it("accepts an unproved AC before audit on only the three authorized grounds", () => {
    const source = step7();
    const start = source.indexOf("Accepted grounds:");
    const end = source.indexOf("Re-ask checks:", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const grounds = source.slice(start, end);
    expect([...grounds.matchAll(/^   - \(([a-z])\) (.+)$/gm)].map((match) => match[1])).toEqual(["a", "b", "c"]);
    expect(grounds).toContain("revised brief moves the AC to a later item");
    expect(grounds).toContain("real-app half of a `device` AC goes to a card");
    expect(grounds).toContain("user waiver recorded as an audit-log gate exception");
    expect(grounds).not.toMatch(/\(d\)|other ground|delegator judgment/i);
    expect(source).toContain("before audit");
    expect(source).toContain("record the acceptance");
    expect(source).toContain("cite it in the audit request");
    expect(source).toContain("send the item back before audit");
  });
});

describe("ADR-0146 coordination rules", () => {
  const rule = (number: number) => fs.readFileSync(
    path.join(root, `.claude/rules/${number === 70 ? "70-multi-session-coordination" : "71-herdr-mixed-roster"}.md`), "utf8",
  );

  it("rule 70 item 4 uses the pinned file and lists Medium findings", () => {
    const source = rule(70);
    const start = source.indexOf("\n4. **Every WI or finished module is audited before it lands**");
    const end = source.indexOf("\n5. The sequencing-doc row", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const item = source.slice(start, end);
    for (const phrase of ["docs/agents/audit-dimensions.md", "<B>", "§ Which set", "Mediums are listed", "Lows counted", "Round one is blind", "counter-proof"]) {
      expect(item, phrase).toContain(phrase);
    }
    for (const obsolete of ["runs\n   `/cc-suite:audit --mini`", "mini's five unless the request names full's nine", "both auditors on full's nine dimensions", "reports only Critical\n   and High findings"]) {
      expect(item, obsolete).not.toContain(obsolete);
    }
  });

  it("rule 71 keeps unproved AC acceptance scoped and blocks unmet landing", () => {
    const source = rule(71);
    const review = source.slice(source.indexOf("**A review with zero Critical"), source.indexOf("- receipts, number reservation"));
    const briefs = section(source, "Briefs and self-acceptance");
    const audits = section(source, "Audits under herdr");
    expect(review).toContain("Medium `NOT PROVED` does not license landing the AC unmet");
    for (const phrase of ["ADR-0146 decision 4", "recorded acceptance", "audit request", "before any audit starts", "revised brief", "device", "user waiver"]) {
      expect(briefs, phrase).toContain(phrase);
    }
    expect(audits).toContain("docs/agents/audit-dimensions.md");
    expect(audits).toContain("<B>");
  });

  it("routes dimensions-file changes through a High PR and excludes direct docs-only landing", () => {
    const source = rule(70);
    const tier = source.slice(source.indexOf("- **Low** (CSS, docs"), source.indexOf("- **Medium**", source.indexOf("- **Low** (CSS, docs")));
    const item4 = source.slice(source.indexOf("4. **Every WI or finished module is audited"), source.indexOf("5. The sequencing-doc row"));
    const skill = fs.readFileSync(path.join(root, ".agents/skills/mdpro-delegator/SKILL.md"), "utf8");
    const step8 = skill.slice(skill.indexOf("8. **Land**"), skill.indexOf("9. **Device batches**"));
    expect(tier).toContain("except `docs/agents/audit-dimensions.md`");
    expect(tier).toContain("High tier");
    const lowBullet = source.split("- **Low** (CSS, docs")[1]?.split("\n   - **Base.**")[0] ?? "";
    expect(lowBullet).toContain("except `docs/agents/audit-dimensions.md`");
    expect(lowBullet).toContain("excluded file is High tier");
    for (const phrase of ["docs/agents/audit-dimensions.md", "PR", "High tier", "old pinned blob", "plan review", "both auditors", "never a direct docs-only commit"]) {
      expect(item4, phrase).toContain(phrase);
    }
    expect(step8).toContain("never for `docs/agents/audit-dimensions.md`");
    const guide = fs.readFileSync(path.join(root, ".agents/skills/mdpro-delegator/references/guide.md"), "utf8");
    const checklist = fs.readFileSync(path.join(root, ".agents/skills/mdpro-delegator/references/templates/landing-docs-checklist.md"), "utf8");
    for (const source of [guide, checklist]) {
      expect(source).toContain("docs/agents/audit-dimensions.md");
      expect(source).toContain("ADR-0146 decision 1");
      expect(source).toContain("High-tier PR");
    }
  });
});

describe("GH586 docs-only landing excludes the policy set file", () => {
  it("names docs/agents/audit-policy-set.md beside the dimensions file wherever direct docs-only landing is described", () => {
    const skill = fs.readFileSync(path.join(root, ".agents/skills/mdpro-delegator/SKILL.md"), "utf8");
    const step8 = skill.slice(skill.indexOf("8. **Land**"), skill.indexOf("9. **Device batches**"));
    const guide = fs.readFileSync(path.join(root, ".agents/skills/mdpro-delegator/references/guide.md"), "utf8");
    const checklist = fs.readFileSync(path.join(root, ".agents/skills/mdpro-delegator/references/templates/landing-docs-checklist.md"), "utf8");
    expect(step8).toContain("never for `docs/agents/audit-dimensions.md` or `docs/agents/audit-policy-set.md`");
    for (const source of [guide, checklist]) {
      expect(source).toContain("except `docs/agents/audit-dimensions.md` and `docs/agents/audit-policy-set.md` (ADR-0146 decision 1");
    }
  });
});

describe("ADR-0146 accepted-ADR forward links", () => {
  const records = [
    {
      id: "0085",
      file: "0085-a-branch-is-audited-before-it-is-fast-forwarded-onto-master.md",
      clauses: ["decision 4", "direct docs-only"],
      bodyHash: "a37e8bb45f932dcb984cec9d05cfa64e564c4cdc1395104dcae1b5662a26fc98",
    },
    {
      id: "0115",
      file: "0115-every-pre-landing-audit-runs-twice-codex-and-fable-on-the-same-dimensions.md",
      clauses: ["decisions 1 and 3", "dimension set", "Medium"],
      bodyHash: "8fee362e2a5aec9bd40604c3ea07e676d9eb5d4964c2f836275b7413009ba8be",
    },
    {
      id: "0121",
      file: "0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md",
      clauses: ["decision 1", "audit set", "docs/**"],
      bodyHash: "57aa0dfe85d613d50a8307a45584d9c0858af96cbcb47dcfeea5ae04ba72e382",
    },
  ];

  it("dates each clause-specific partial supersession in Status", () => {
    for (const record of records) {
      const source = fs.readFileSync(path.join(root, "docs/adr", record.file), "utf8");
      const context = source.indexOf("## Context\n");
      expect(context, record.id).toBeGreaterThan(0);
      const status = source.slice(0, context);
      expect(status, record.id).toContain("2026-10-28");
      expect(status, record.id).toContain("partially superseded:");
      expect(status, record.id).toContain("by [ADR-0146](0146-audits-use-project-dimensions-kept-in-the-repo.md)");
      for (const clause of record.clauses) expect(status, `${record.id}: ${clause}`).toContain(clause);
    }
  });

  it("leaves accepted ADR bodies byte-identical to the grant base", () => {
    for (const record of records) {
      const source = fs.readFileSync(path.join(root, "docs/adr", record.file), "utf8");
      const body = source.slice(source.indexOf("## Context\n"));
      expect(createHash("sha256").update(body).digest("hex"), record.id).toBe(record.bodyHash);
    }
  });
});
