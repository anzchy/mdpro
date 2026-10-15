// @vitest-environment node
/**
 * Purpose: E2E-WI-1, the per-file half of the journey gate: the `json journey`
 * metadata block is found and parsed (`parse.mjs`), and its fields follow the
 * plan's §4.1 schema (`schema.mjs`). One case per rule in the plan's
 * acceptance 3 that a single file can break: bad JSON, missing fields or bad
 * enums, `n/a` without a reason; plus the §4.1 rules the acceptance implies
 * (group order, case platforms, retired reason, draft checked for structure only).
 *
 * @module tests/tooling/journeys-schema.test
 * @coordinates-with scripts/journeys/parse.mjs, scripts/journeys/schema.mjs
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { parseJourney } from "../../scripts/journeys/parse.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { checkMeta } from "../../scripts/journeys/schema.mjs";
import { journeyMd, validMeta, type Meta } from "../support/journeysFixture";

interface Finding {
  rule: string;
  message: string;
}

const rulesOf = (meta: Meta) => (checkMeta(meta) as Finding[]).map((f) => f.rule);

describe("parseJourney", () => {
  it("reads the first `json journey` block and the body's level-2 sections", () => {
    const parsed = parseJourney(journeyMd(validMeta()));
    expect(parsed.findings).toEqual([]);
    expect(parsed.meta.id).toBe("EJ-001");
    expect(parsed.sections).toEqual(["Why", "Setup", "Steps", "Oracle", "Controls", "Failure condition", "Cleanup"]);
  });

  it("reports a file with no metadata block", () => {
    const parsed = parseJourney("# A journey\n\n## Why\n");
    expect(parsed.meta).toBeNull();
    expect(parsed.findings.map((f: Finding) => f.rule)).toEqual(["journey-meta-missing"]);
  });

  it("reports a metadata block that is not the first code block", () => {
    const parsed = parseJourney("# J\n\n```sh\nls\n```\n\n" + journeyMd(validMeta()));
    expect(parsed.findings.map((f: Finding) => f.rule)).toEqual(["journey-meta-missing"]);
  });

  it("reports bad JSON with the parser's message", () => {
    const parsed = parseJourney(journeyMd('{ "id": "EJ-001", }'));
    expect(parsed.meta).toBeNull();
    expect(parsed.findings.map((f: Finding) => f.rule)).toEqual(["journey-meta-json"]);
  });

  it("reports metadata that is JSON but not an object", () => {
    const parsed = parseJourney(journeyMd("[1, 2]"));
    expect(parsed.findings.map((f: Finding) => f.rule)).toEqual(["journey-meta-json"]);
  });
});

describe("checkMeta: a valid journey", () => {
  it("has no findings", () => {
    expect(checkMeta(validMeta())).toEqual([]);
  });

  it("accepts a case with no mode (a launcher-only case)", () => {
    expect(rulesOf(validMeta({ cases: [{ id: "C1", intended: "x" }] }))).toEqual([]);
  });
});

describe("checkMeta: fields", () => {
  for (const field of ["id", "title", "status", "area", "tier", "platforms", "projection", "ledger", "cases"]) {
    it(`a missing \`${field}\` is a finding`, () => {
      const meta = validMeta();
      delete meta[field];
      expect(rulesOf(meta)).toContain("journey-meta-field");
    });
  }

  it("an id that is not EJ-NNN is a finding", () => {
    expect(rulesOf(validMeta({ id: "EJ-1" }))).toContain("journey-meta-field");
  });

  it("an empty tier list is a finding", () => {
    expect(rulesOf(validMeta({ tier: [] }))).toContain("journey-meta-field");
  });

  it("a ledger entry without covers is a finding", () => {
    expect(rulesOf(validMeta({ ledger: [{ row: "打开文件" }] }))).toContain("journey-meta-field");
  });

  it("a case without intended is a finding", () => {
    expect(rulesOf(validMeta({ cases: [{ id: "C1" }] }))).toContain("journey-meta-field");
  });
});

describe("checkMeta: enums", () => {
  it.each([
    ["status", { status: "live" }],
    ["tier", { tier: ["smoke", "nightly"] }],
    ["platform status", { platforms: { macos: { status: "maybe" }, windows: { status: "required" } } }],
    ["case mode", { cases: [{ id: "C1", mode: "X", intended: "x" }] }],
    ["case status", { cases: [{ id: "C1", intended: "x", status: "gone" }] }],
  ])("a bad %s is a finding", (_name, overrides) => {
    expect(rulesOf(validMeta(overrides))).toContain("journey-meta-enum");
  });

  it("a platform other than macos and windows is a finding", () => {
    const platforms = { macos: { status: "required" }, windows: { status: "required" }, linux: { status: "n/a" } };
    expect(rulesOf(validMeta({ platforms }))).toContain("journey-meta-enum");
  });

  it("a case limited to an unknown platform is a finding", () => {
    expect(rulesOf(validMeta({ cases: [{ id: "C1", intended: "x", platforms: ["ios"] }] }))).toContain(
      "journey-meta-enum",
    );
  });
});

describe("checkMeta: §4.1 rules", () => {
  it("`n/a` without a reason is a finding; with one it is fine", () => {
    const na = (reason?: string) => ({
      platforms: { macos: { status: "required" }, windows: reason ? { status: "n/a", reason } : { status: "n/a" } },
    });
    expect(rulesOf(validMeta(na()))).toContain("journey-na-reason");
    expect(rulesOf(validMeta(na("no counterpart on Windows")))).toEqual([]);
  });

  it("a case id used twice in one journey is a finding, retired or not", () => {
    const cases = [
      { id: "C1", intended: "x", status: "retired" },
      { id: "C1", intended: "y" },
    ];
    expect(rulesOf(validMeta({ cases }))).toContain("journey-case-dup");
  });

  it("a group without an order is a finding", () => {
    expect(rulesOf(validMeta({ group: "watcher" }))).toContain("journey-group-order");
    expect(rulesOf(validMeta({ group: "watcher", order: 1 }))).toEqual([]);
  });

  it("a retired journey needs a reason", () => {
    expect(rulesOf(validMeta({ status: "retired" }))).toContain("journey-retired-reason");
    expect(rulesOf(validMeta({ status: "retired", reason: "superseded by EJ-009" }))).toEqual([]);
  });

  it("a draft journey is checked for structure only: a bad enum deeper down is not reported", () => {
    const meta = validMeta({ status: "draft", cases: [{ id: "C1", mode: "X", intended: "x" }] });
    expect(rulesOf(meta)).toEqual([]);
  });

  it("a draft journey still needs its id, title and status", () => {
    expect(rulesOf({ status: "draft", title: "t" })).toContain("journey-meta-field");
  });
});
