// @vitest-environment node
/**
 * Purpose: E2E-WI-1, the run manifest (`manifest.mjs`, plan §4.6): which cases
 * a journey requires on a platform (§4.1 inheritance), the aggregation rule
 * (INCOMPLETE is not green; XFAIL does not count against a pass; optional
 * cases never decide it), and the manifest schema, including that a stated
 * verdict must equal the aggregated one and that an INCOMPLETE or interrupted
 * run gives its reason.
 *
 * @module tests/tooling/journeys-manifest.test
 * @coordinates-with scripts/journeys/manifest.mjs
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { aggregateJourney, aggregateRun, checkManifest, requiredCases } from "../../scripts/journeys/manifest.mjs";
import { validMeta, type Meta } from "../support/journeysFixture";

interface Finding {
  rule: string;
  message: string;
}

const cases = [
  { id: "C1", intended: "a" },
  { id: "C2", intended: "b", optional: ["windows"] },
  { id: "C3", intended: "c", platforms: ["macos"] },
  { id: "C4", intended: "d", status: "retired" },
];
const META = validMeta({ cases });

describe("requiredCases", () => {
  it("a required platform requires every live case that applies to it and is not optional there", () => {
    expect(requiredCases(META, "macos")).toEqual(["C1", "C2", "C3"]);
    expect(requiredCases(META, "windows")).toEqual(["C1"]);
  });

  it("an optional or n/a platform requires nothing", () => {
    const optional = { ...META, platforms: { macos: { status: "optional" }, windows: { status: "n/a", reason: "r" } } };
    expect(requiredCases(optional, "macos")).toEqual([]);
    expect(requiredCases(optional, "windows")).toEqual([]);
  });
});

describe("aggregateJourney", () => {
  const verdicts = (v: Record<string, string>) => Object.entries(v).map(([id, verdict]) => ({ id, verdict }));

  it("PASS when every required case is PASS or XFAIL", () => {
    expect(aggregateJourney(META, "macos", verdicts({ C1: "PASS", C2: "XFAIL", C3: "PASS" }))).toBe("PASS");
  });

  it("FAIL when a required case is FAIL or XPASS", () => {
    expect(aggregateJourney(META, "macos", verdicts({ C1: "FAIL", C2: "PASS", C3: "PASS" }))).toBe("FAIL");
    expect(aggregateJourney(META, "macos", verdicts({ C1: "XPASS", C2: "PASS", C3: "PASS" }))).toBe("FAIL");
  });

  it("INCOMPLETE when a required case is 未执行, BLOCKED or missing", () => {
    expect(aggregateJourney(META, "macos", verdicts({ C1: "未执行", C2: "PASS", C3: "PASS" }))).toBe("INCOMPLETE");
    expect(aggregateJourney(META, "macos", verdicts({ C1: "BLOCKED", C2: "PASS", C3: "PASS" }))).toBe("INCOMPLETE");
    expect(aggregateJourney(META, "macos", verdicts({ C1: "PASS", C2: "PASS" }))).toBe("INCOMPLETE");
  });

  it("an optional case never decides it, even when it fails", () => {
    expect(aggregateJourney(META, "windows", verdicts({ C1: "PASS", C2: "FAIL" }))).toBe("PASS");
  });

  it("N/A when the platform is n/a", () => {
    const na = { ...META, platforms: { macos: { status: "required" }, windows: { status: "n/a", reason: "r" } } };
    expect(aggregateJourney(na, "windows", [])).toBe("N/A");
  });
});

describe("aggregateRun", () => {
  it.each([
    [["PASS", "PASS", "N/A"], "PASS"],
    [["PASS", "FAIL", "INCOMPLETE"], "FAIL"],
    [["PASS", "INCOMPLETE"], "INCOMPLETE"],
    [["N/A"], "INCOMPLETE"],
    [[], "INCOMPLETE"],
  ])("%j → %s", (journeyVerdicts, expected) => {
    expect(aggregateRun(journeyVerdicts)).toBe(expected);
  });
});

/** A manifest for one macOS smoke run of EJ-001 whose stated verdicts are consistent. */
function manifest(overrides: Meta = {}): Meta {
  return {
    runId: "2026-10-15-smoke-macos-839bb4d-1",
    build: { sha: "839bb4d8f5061f04bfe6a8403dae7152abc0f226", binarySha256: "a".repeat(64), profile: "release", platform: "macos", os: "macOS 15.6" },
    tier: "smoke",
    journeys: [
      {
        id: "EJ-001",
        revision: "b".repeat(40),
        projectionVersion: 1,
        fixtures: {},
        cases: [
          { id: "C1", verdict: "PASS", evidence: ["mdpro.log:120-131"] },
          { id: "C2", verdict: "PASS", evidence: ["golden equal"] },
          { id: "C3", verdict: "PASS", evidence: ["golden equal"] },
          { id: "C4", verdict: "N/A", evidence: [] },
        ],
        verdict: "PASS",
      },
    ],
    verdict: "PASS",
    ...overrides,
  };
}

const catalogue = new Map([["EJ-001", META]]);
const rules = (m: Meta) => (checkManifest(m, catalogue) as Finding[]).map((f) => f.rule);

describe("checkManifest", () => {
  it("a consistent manifest has no findings", () => {
    expect(checkManifest(manifest(), catalogue)).toEqual([]);
  });

  it.each([
    ["a runId that does not match the build", { runId: "2026-10-15-smoke-macos-0000000-1" }],
    ["a short build sha", { build: { ...manifest().build as Meta, sha: "839bb4d" } }],
    ["an unknown tier", { tier: "nightly" }],
    ["an unknown verdict word", { verdict: "GREEN" }],
    ["no journeys key", { journeys: undefined }],
  ])("%s is a schema finding", (_name, overrides) => {
    expect(rules(manifest(overrides))).toContain("manifest-schema");
  });

  it("a journey not in the catalogue is a finding", () => {
    const m = manifest();
    (m.journeys as Meta[])[0].id = "EJ-404";
    expect(rules(m)).toContain("manifest-journey");
  });

  it("a stated journey verdict that contradicts the aggregation is a finding", () => {
    const m = manifest();
    const j = (m.journeys as Meta[])[0];
    (j.cases as Meta[])[0].verdict = "未执行";
    expect(rules(m)).toContain("manifest-verdict");
  });

  it("a stated run verdict that contradicts the journeys is a finding", () => {
    expect(rules(manifest({ verdict: "FAIL" }))).toContain("manifest-verdict");
  });

  it("an INCOMPLETE run without a reason is a finding", () => {
    const m = manifest({ verdict: "INCOMPLETE" });
    const j = (m.journeys as Meta[])[0];
    (j.cases as Meta[])[0].verdict = "BLOCKED";
    j.verdict = "INCOMPLETE";
    expect(rules(m)).toContain("manifest-reason");
    expect(rules({ ...m, incompleteReason: "win-desktop lost its session at C1" })).toEqual([]);
  });

  it("an interrupted run without a reason is a finding", () => {
    expect(rules(manifest({ interrupted: true }))).toContain("manifest-reason");
  });
});
