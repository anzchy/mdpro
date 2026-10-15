// @vitest-environment node
/**
 * Purpose: E2E-WI-1, the catalogue-wide rules of the journey gate
 * (`catalogue.mjs`) that need no git history: ids unique and matching their
 * file name, every id in REGISTRY.md and every REGISTRY id backed by a file,
 * `supersedes` targets, `knownDefect` D rows, and the README count block.
 *
 * @module tests/tooling/journeys-catalogue.test
 * @coordinates-with scripts/journeys/catalogue.mjs
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { checkCatalogue, countBlock } from "../../scripts/journeys/catalogue.mjs";
import { journeyMd, registryMd, tempRoot, validMeta, type Meta } from "../support/journeysFixture";

interface Finding {
  rule: string;
  message: string;
}

const J = "tests/journeys";
const SEQ = "docs/plans/20260912-frontend-backend-sequencing-order.md";
const SPIKE = "docs/test/20261002-adr0047-journeys.md";

/** A catalogue root: one file per journey, a registry, a README with the right count, and the files they cite. */
function catalogue(journeys: Meta[], extra: Record<string, string> = {}, registry?: string[]): string {
  const files: Record<string, string> = {
    [`${J}/REGISTRY.md`]: registryMd(registry ?? journeys.map((m) => String(m.id))),
    [SEQ]: '| <a id="d228"></a>**D228** | row |\n',
    [SPIKE]: "### J1a — cold start with a path argument\n",
  };
  for (const meta of journeys) {
    files[`${J}/${String(meta.id)}-x.md`] = journeyMd(meta);
    files[String(meta.projection)] = JSON.stringify({ projectionVersion: 1, events: {} });
  }
  files[`${J}/README.md`] = `# Journeys\n\n${countBlock(journeys)}\n`;
  return tempRoot({ ...files, ...extra });
}

const rules = (root: string) => (checkCatalogue(root) as Finding[]).map((f) => f.rule);
const meta = (id: string, overrides: Meta = {}) =>
  validMeta({ id, projection: `${J}/projections/${id}.json`, ...overrides });

describe("checkCatalogue: a valid catalogue", () => {
  it("has no findings", () => {
    expect(checkCatalogue(catalogue([meta("EJ-001"), meta("EJ-002")]))).toEqual([]);
  });
});

describe("ids and the registry", () => {
  it("two files with the same id is a finding", () => {
    const root = catalogue([meta("EJ-001")], { [`${J}/EJ-001-other.md`]: journeyMd(meta("EJ-001")) });
    expect(rules(root)).toContain("journey-id-dup");
  });

  it("a file whose name does not start with its id is a finding", () => {
    const root = catalogue([meta("EJ-001")], { [`${J}/EJ-007-wrong.md`]: journeyMd(meta("EJ-002")) }, [
      "EJ-001",
      "EJ-002",
    ]);
    expect(rules(root)).toContain("journey-file-name");
  });

  it("an id missing from REGISTRY.md is a finding", () => {
    expect(rules(catalogue([meta("EJ-001"), meta("EJ-002")], {}, ["EJ-001"]))).toContain("journey-unregistered");
  });

  it("a REGISTRY id with no journey file is a finding (files are never deleted)", () => {
    expect(rules(catalogue([meta("EJ-001")], {}, ["EJ-001", "EJ-002"]))).toContain("journey-file-missing");
  });

  it("a file that fails to parse is reported and does not stop the other checks", () => {
    const root = catalogue([meta("EJ-001")], { [`${J}/EJ-002-bad.md`]: journeyMd("{ nope") }, ["EJ-001", "EJ-002"]);
    expect(rules(root)).toContain("journey-meta-json");
  });
});

describe("supersedes", () => {
  it("a target that exists nowhere is a finding", () => {
    expect(rules(catalogue([meta("EJ-001", { supersedes: ["EJ-009"] })]))).toContain("journey-supersedes");
  });

  it("an ADR-0047 spike id resolves against the spike document", () => {
    expect(rules(catalogue([meta("EJ-001", { supersedes: ["J1a"] })]))).toEqual([]);
    expect(rules(catalogue([meta("EJ-001", { supersedes: ["J9z"] })]))).toContain("journey-supersedes");
  });

  it("a cycle is a finding", () => {
    const a = meta("EJ-001", { status: "retired", reason: "r", supersedes: ["EJ-002"] });
    const b = meta("EJ-002", { status: "retired", reason: "r", supersedes: ["EJ-001"] });
    expect(rules(catalogue([a, b]))).toContain("journey-supersedes-cycle");
  });

  it("a superseded journey that is still active is a finding", () => {
    const root = catalogue([meta("EJ-001"), meta("EJ-002", { supersedes: ["EJ-001"] })]);
    expect(rules(root)).toContain("journey-supersedes-current");
  });

  it("a superseded journey still cited by a ledger marker is a finding", () => {
    const old = meta("EJ-001", { status: "retired", reason: "replaced" });
    const root = catalogue([old, meta("EJ-002", { supersedes: ["EJ-001"] })], {
      "docs/feature-ledger.md": "| 打开文件 | Shipped | `src/x.ts` | 旅程：EJ-001 |\n",
    });
    expect(rules(root)).toContain("journey-supersedes-current");
  });
});

describe("knownDefect", () => {
  const withDefect = (d: string) => meta("EJ-001", { cases: [{ id: "C1", intended: "x", knownDefect: d }] });

  it("a D row that exists passes; one that does not is a finding", () => {
    expect(rules(catalogue([withDefect("D228")]))).toEqual([]);
    expect(rules(catalogue([withDefect("D9999")]))).toContain("journey-known-defect");
  });

  it("a malformed D id is a finding", () => {
    expect(rules(catalogue([withDefect("bug 12")]))).toContain("journey-known-defect");
  });
});

describe("the README count", () => {
  it("is generated from the catalogue, by status", () => {
    const block = countBlock([meta("EJ-001"), meta("EJ-002", { status: "draft" })]);
    expect(block).toContain("**2** journeys: 1 active, 1 draft, 0 retired");
  });

  it("a stale count is a finding", () => {
    const root = catalogue([meta("EJ-001"), meta("EJ-002")], {
      [`${J}/README.md`]: `# Journeys\n\n${countBlock([meta("EJ-001")])}\n`,
    });
    expect(rules(root)).toContain("journey-count");
  });

  it("a README with no count block is a finding", () => {
    expect(rules(catalogue([meta("EJ-001")], { [`${J}/README.md`]: "# Journeys\n" }))).toContain("journey-count");
  });
});
