// @vitest-environment node
// D355 fix 4 (receipt D355-S20): the properties that replace the SHA-pinned cases. No D355 test reads a git object
// outside the checked-out tree; the superseded-phrase scanner is calibrated on recorded candidate text; the D302
// exceptions file names no D355 file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hitsIn, normalise, normPhrase, SUPERSEDED } from "./d355-fix1-lib";
import { CANDIDATE_SITES, D355_TEST_FILES, d355Exceptions, historyReads } from "./d355-fix4-lib";

const root = path.resolve(__dirname, "../..");
const EXCEPTIONS = "scripts/lint/d302-sync-exceptions.json";
const REF = ".agents/skills/mdpro-delegator/references";
const SITES = [
  ...[20, 53, 56, 72].map((n) => `${REF}/roster-and-routing.md:${n}`),
  ...[121, 149, 150, 153, 154, 232, 236, 267].map((n) => `${REF}/landing-and-audit.md:${n}`),
];
const FLAGGED_FIX3 = ["codex-land-guard-export.test.ts", "d355-fix1-lib.ts", "d355-r3-history.test.ts",
  "gh586-audit-policy-split.test.ts", "rules-budget-fixture.ts", "rules-budget-lib.test.ts", "rules-lib-core.ts"]
  .map((f) => `tests/tooling/${f}`);
const scanned = () => [...new Set([...D355_TEST_FILES, ...fs.readdirSync(path.join(root, "tests/tooling"))
  .filter((f) => f.startsWith("d355-")).map((f) => `tests/tooling/${f}`)])].sort();
// the calibration lines are assembled here so this file holds no literal git call of its own (gap 5c: by line, not file)
const Q = (s: string) => `"${s}"`;
const call = (fn: string, argv: string[]) => `${fn}(${Q("git")}, [${argv.join(", ")}])`;

const made: string[] = [];
afterAll(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function tmpJson(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d355-fix4-"));
  made.push(dir);
  const file = path.join(dir, "exceptions.json");
  fs.writeFileSync(file, body);
  return file;
}

describe("D355 fix 4: no permanent D355 test needs history", () => {
  it("F0-cal: the detector flags history reads and passes tree-local git and prose", () => {
    const flagged = [
      call("run", [Q("show"), "`${BASE}:x`"]),
      call("runFile", [Q("cat-file"), Q("-s"), "X"]),
      call("execFile", [Q("diff"), Q("22ffe5ea"), Q("HEAD")]),
      call("runFile", [Q("log"), Q("-p"), Q("9c32bcde")]),
    ];
    const clean = [call("runFile", [Q("ls-files"), Q("-z")]), 'expect(head).toContain("`git cat-file -p <P>`");'];
    expect(historyReads([...flagged, ...clean].join("\n"))).toEqual([1, 2, 3, 4]);
  });

  it("F0: no D355 test file or lib reads a git object outside the checked-out tree", () => {
    const offenders = scanned().flatMap((f) => historyReads(fs.readFileSync(path.join(root, f), "utf8")).map((n) => `${f}:${n}`));
    expect(offenders).toEqual([]);
  });

  it("F4: the scanned list holds fix 3's flagged files, and every listed file exists", () => {
    for (const f of FLAGGED_FIX3) expect(D355_TEST_FILES, f).toContain(f);
    for (const f of D355_TEST_FILES) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
  });
});

describe("D355 fix 4: the superseded-phrase scanner, calibrated on the candidate's text (was fx1 A1-cal)", () => {
  it("F1: every recorded site has a superseded phrase starting on its first line", () => {
    expect(Object.keys(CANDIDATE_SITES)).toEqual(SITES);
    for (const site of SITES) {
      expect(hitsIn("s", CANDIDATE_SITES[site] ?? "", SUPERSEDED).some((h) => h.startsWith("s:1: ")), site).toBe(true);
    }
  });

  it("F1c: the calibration needs normalise: some site's phrase is not a raw substring of its text", () => {
    const raw = SITES.filter((site) => {
      const text = CANDIDATE_SITES[site] ?? "";
      const first = hitsIn("s", text, SUPERSEDED).filter((h) => h.startsWith("s:1: ")).map((h) => h.slice("s:1: ".length));
      return first.length > 0 && first.every((p) => !text.toLowerCase().includes(p.toLowerCase()));
    });
    expect(raw.length).toBeGreaterThan(0);
    expect(normalise(CANDIDATE_SITES[raw[0]] ?? "").s).toContain(normPhrase("three rounds"));
  });
});

describe("D355 fix 4: the D302 exceptions file names no D355 file (was fix3-lint L11)", () => {
  it("F2: a copy of the real file with two D355 entries reports exactly those two", () => {
    const real = JSON.parse(fs.readFileSync(path.join(root, EXCEPTIONS), "utf8")) as Array<{ file: string; reason: string }>;
    const extra = [
      { file: "tests/tooling/d355-fix1-lib.ts", reason: "x" },
      { file: "tests/control/not-d355.test.ts", reason: "x" },
      { file: "tests/tooling/rules-lib-core.ts", reason: "x" },
    ];
    expect(d355Exceptions(tmpJson(JSON.stringify([...real, ...extra], null, 2))))
      .toEqual(["tests/tooling/d355-fix1-lib.ts", "tests/tooling/rules-lib-core.ts"]);
    expect(d355Exceptions(tmpJson(JSON.stringify([{ file: "tests/tooling/d355-later.test.ts", reason: "x" }]))))
      .toEqual(["tests/tooling/d355-later.test.ts"]);
  });

  it("F2b: a file that is not an array of entries throws", () => {
    expect(() => d355Exceptions(tmpJson(JSON.stringify({ entries: [] })))).toThrow(/array/);
    expect(() => d355Exceptions(tmpJson(JSON.stringify([{ path: "tests/tooling/d355-x.ts" }])))).toThrow(/file/);
  });

  it("F3: the real exceptions file has no D355 entry", () => {
    expect(d355Exceptions(path.join(root, EXCEPTIONS))).toEqual([]);
  });
});
