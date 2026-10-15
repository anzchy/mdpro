// @vitest-environment node
/**
 * Purpose: E2E-WI-1, the files a journey cites: Tier-0 and Rust tests exist
 * and point back on their first line (both directions), the projection file
 * parses, and the minimal `fixture.json` (sha256 per file, optional
 * generator run with `--check`) holds. Golden-source fields and the key
 * format are WI-E2E-2's (delegator ruling Q-a, 2026-10-15).
 *
 * A draft journey is checked for structure only, so none of these apply to it.
 *
 * @module tests/tooling/journeys-links.test
 * @coordinates-with scripts/journeys/catalogue.mjs, scripts/journeys/fixtures.mjs
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { checkCatalogue, countBlock } from "../../scripts/journeys/catalogue.mjs";
import { journeyMd, registryMd, tempRoot, validMeta, type Meta } from "../support/journeysFixture";

interface Finding {
  rule: string;
  message: string;
}

const J = "tests/journeys";
const TIER0 = "tests/ej-001-open.test.ts";
const RUST = "src-tauri/src/commands/ej001_golden_tests.rs";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function root(meta: Meta, extra: Record<string, string> = {}): string {
  return tempRoot({
    [`${J}/REGISTRY.md`]: registryMd([String(meta.id)]),
    [`${J}/${String(meta.id)}-x.md`]: journeyMd(meta),
    [`${J}/README.md`]: `# Journeys\n\n${countBlock([meta])}\n`,
    [`${J}/projections/EJ-001.json`]: JSON.stringify({ projectionVersion: 1, events: {} }),
    ...extra,
  });
}

const rules = (r: string) => (checkCatalogue(r) as Finding[]).map((f) => f.rule);

describe("Tier-0 and Rust tests", () => {
  const linked = validMeta({ tier0: [TIER0], rust: [RUST] });
  const files = {
    [TIER0]: "// Tier-0 for EJ-001\nimport { it } from 'vitest';\n",
    [RUST]: "// Rust golden for EJ-001\n#[test]\nfn t() {}\n",
  };

  it("both linked both ways pass", () => {
    expect(rules(root(linked, files))).toEqual([]);
  });

  it("a Tier-0 file may put the back-reference right after a vitest environment line", () => {
    const tier0 = "// @vitest-environment node\n// Tier-0 for EJ-001\n";
    expect(rules(root(linked, { ...files, [TIER0]: tier0 }))).toEqual([]);
  });

  it("a cited file that does not exist is a finding", () => {
    expect(rules(root(linked, { [RUST]: files[RUST] }))).toContain("journey-test-missing");
  });

  it("a cited file that does not point back is a finding", () => {
    expect(rules(root(linked, { ...files, [TIER0]: "import { it } from 'vitest';\n" }))).toContain(
      "journey-test-backref",
    );
  });

  it("a cited file that points at another journey is a finding", () => {
    expect(rules(root(linked, { ...files, [RUST]: "// Rust golden for EJ-002\n" }))).toContain(
      "journey-test-backref",
    );
  });

  it("a test that points at a journey which does not list it is a finding (one-way link)", () => {
    const stray = { ...files, "tests/ej-001-extra.test.ts": "// Tier-0 for EJ-001\n" };
    expect(rules(root(linked, stray))).toContain("journey-test-backref");
  });

  it("a Rust test that points at a journey which does not list it is a finding", () => {
    const stray = { ...files, "src-tauri/src/other_tests.rs": "// Rust golden for EJ-001\n" };
    expect(rules(root(linked, stray))).toContain("journey-test-backref");
  });
});

describe("the projection file", () => {
  it("bad JSON is a finding", () => {
    expect(rules(root(validMeta(), { [`${J}/projections/EJ-001.json`]: "{" }))).toContain("journey-projection");
  });

  it("a missing projectionVersion is a finding", () => {
    expect(rules(root(validMeta(), { [`${J}/projections/EJ-001.json`]: '{"events":{}}' }))).toContain(
      "journey-projection",
    );
  });

  it("a missing projection file is a finding", () => {
    expect(rules(root(validMeta({ projection: `${J}/projections/EJ-404.json` })))).toContain("journey-projection");
  });
});

describe("fixtures (minimal fixture.json)", () => {
  const F = `${J}/fixtures/open-basic`;
  const withFixture = validMeta({ fixtures: ["open-basic"] });
  const good = {
    [`${F}/doc.md`]: "# hello\n",
    [`${F}/expected/EJ-001-C1.md`]: "# hello\n",
    [`${F}/fixture.json`]: JSON.stringify({
      files: { "doc.md": sha("# hello\n"), "expected/EJ-001-C1.md": sha("# hello\n") },
    }),
  };

  it("matching sha256s pass", () => {
    expect(rules(root(withFixture, good))).toEqual([]);
  });

  it("a fixture id with no directory or fixture.json is a finding", () => {
    expect(rules(root(validMeta({ fixtures: ["nope"] })))).toContain("journey-fixture");
  });

  it("an edited input file is a finding", () => {
    expect(rules(root(withFixture, { ...good, [`${F}/doc.md`]: "# edited\n" }))).toContain("journey-fixture-sha");
  });

  it("an edited golden is a finding", () => {
    expect(rules(root(withFixture, { ...good, [`${F}/expected/EJ-001-C1.md`]: "x" }))).toContain(
      "journey-fixture-sha",
    );
  });

  it("a listed file that is missing is a finding", () => {
    const { [`${F}/doc.md`]: _gone, ...rest } = good;
    expect(rules(root(withFixture, rest))).toContain("journey-fixture-sha");
  });

  it("a generator whose --check fails is a finding; one that passes is not", () => {
    const gen = (code: number) => ({
      ...good,
      "scripts/gen.mjs": `if (!process.argv.includes("--check")) process.exit(9); process.exit(${code});\n`,
      [`${F}/fixture.json`]: JSON.stringify({
        files: JSON.parse(good[`${F}/fixture.json`]).files,
        generator: { script: "scripts/gen.mjs", args: [] },
      }),
    });
    expect(rules(root(withFixture, gen(0)))).toEqual([]);
    expect(rules(root(withFixture, gen(3)))).toContain("journey-fixture-generator");
  });
});

describe("a draft journey", () => {
  it("is not held to its links", () => {
    const draft = validMeta({ status: "draft", tier0: [TIER0], fixtures: ["nope"], projection: "x.json" });
    expect(rules(root(draft))).toEqual([]);
  });
});
