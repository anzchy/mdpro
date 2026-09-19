/**
 * WI-3.5.8 — matrix case Z2: the fourth (dead) slug generator is gone from the tree,
 * and every comment that cited it is gone with it.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260918-214500.md` §"Unit: WI-3.5.8", case Z2.
 *
 * Why this file exists rather than a line folded into one of the heading-identity
 * suites: those three files are *subjects* of this assertion — they each carried a
 * stale `generateAnchorId` citation. A file that asserts about its own text is a file
 * whose assertion can be satisfied by editing the assertion, and it also mixes a
 * `node:fs` text sweep into suites whose job is behavioural law. Keeping the guard in
 * its own file keeps subject and judge apart. Precedent for asserting against source
 * text in this repo: `tests/wholesale-path-partition.test.ts` (case W5) and
 * `tests/focus-trap.test.ts`.
 *
 * SCOPE, because the counts below are easy to over-read: every number in this file
 * counts slug generators **in the repo tree**. Since WI-3.6 it is known that the
 * running app carries one more face than the tree does — the heading DOM ids
 * `@milkdown/preset-commonmark@7.18.0` writes on the WYSIWYG surface. That one lives
 * in `node_modules`, is owned by nobody here, is read by no mdpro code (ADR-0014),
 * and is therefore outside this sweep **by construction**, not by oversight. Its
 * measured behaviour is documented in the header of
 * `tests/heading-identity-faces.test.ts`. Do not widen `SWEEP_ROOTS` to reach it.
 *
 * What is being guarded. Until WI-3.5.8 the tree held FOUR slug generators: three live
 * in-tree faces (`tocService`, the export fallback, `markdown.rs`) and one dead one —
 * `generateAnchorId`, last seen at `src/stores/tocHierarchy.ts:28`, zero callers, and
 * wrong (it strips CJK). Ten references across seven files named it: the definition,
 * one re-export, and eight comments — five of which cited a line number
 * (`src/stores/tocStore.ts:120`) that had already been wrong since
 * WI-3.5.5 moved the function. That is rule 22 comment rot with a receipt. Deleting the
 * function while leaving the citations behind would replace a dead function with a
 * dangling reference to one, which is strictly worse for the next reader.
 *
 * So the sweep is over the whole source and test tree, not just the five known sites:
 * re-introducing a fourth IN-TREE slug generator, or a fresh comment claiming one
 * exists, should fail here.
 *
 * Constraints honoured (matrix §0): no new dependency (real `node:fs`), no mocks.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildTOCHierarchy } from "../src/stores/tocStore";
import type { TOCEntry } from "../src/types/toc";
import { asAnchorSlug, asHeadingKey } from "../src/types/toc";

const REPO = path.resolve(__dirname, "..");

/** The retired symbol. */
const DEAD_SYMBOL = "generateAnchorId";

/**
 * All seven files that named it: one defined it (and described it in its header), one
 * re-exported it, and five cited it in comments. Named explicitly —
 * not just swept — so that a typo in a root path, or a rename that moves a file out
 * of the sweep, cannot turn this case green by reading nothing.
 *
 * Note the last two: `src-tauri/tests/*.rs` are the Rust counterparts named by case Z1.
 * The matrix's Z2 lists only the three `tests/heading-identity-*.test.ts` files; the
 * Rust pair carries the identical stale citation and is included here deliberately.
 */
const CITATION_SITES: readonly string[] = [
  "src/stores/tocHierarchy.ts",
  "src/stores/tocStore.ts",
  "tests/heading-identity-faces.test.ts",
  "tests/heading-identity-fixture-integrity.test.ts",
  "tests/heading-identity-parity.test.ts",
  "src-tauri/tests/heading_identity_parity.rs",
  "src-tauri/tests/heading_slug_generation.rs",
];

/** Roots swept in full. `src-tauri/target` and `node_modules` are never entered. */
const SWEEP_ROOTS: readonly string[] = [
  "src",
  "tests",
  "src-tauri/src",
  "src-tauri/tests",
];

const SWEEP_EXTENSIONS = /\.(tsx?|rs)$/;

/** This guard file necessarily spells the symbol; it is the judge, not a subject. */
const SELF = path.resolve(__filename);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "target") continue;
      walk(full, acc);
    } else if (SWEEP_EXTENSIONS.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function sweptFiles(): string[] {
  const acc: string[] = [];
  for (const root of SWEEP_ROOTS) walk(path.join(REPO, root), acc);
  return acc.filter((f) => path.resolve(f) !== SELF).sort();
}

function rel(file: string): string {
  return path.relative(REPO, file).split(path.sep).join("/");
}

function mentions(file: string): string[] {
  const hits: string[] = [];
  fs.readFileSync(file, "utf-8")
    .split("\n")
    .forEach((line, index) => {
      if (line.includes(DEAD_SYMBOL)) hits.push(`${rel(file)}:${index + 1}`);
    });
  return hits;
}

describe("Z2 — the dead fourth slug generator is gone, and so are its citations", () => {
  const swept = sweptFiles();

  it("the sweep actually read files — no vacuous pass", () => {
    expect(swept.length, "SWEEP_ROOTS resolved to nothing").toBeGreaterThan(100);
    const sweptRel = new Set(swept.map(rel));
    for (const site of CITATION_SITES) {
      const abs = path.join(REPO, site);
      expect(fs.existsSync(abs), `${site} does not exist`).toBe(true);
      expect(
        fs.readFileSync(abs, "utf-8").trim().length,
        `${site} is empty — an empty file trivially satisfies this case`,
      ).toBeGreaterThan(0);
      expect(sweptRel.has(site), `${site} is not covered by SWEEP_ROOTS`).toBe(true);
    }
  });

  it("none of the seven known citation sites still names the symbol", () => {
    const hits = CITATION_SITES.flatMap((site) => mentions(path.join(REPO, site)));
    expect(
      hits,
      "a comment still cites a function that no longer exists (rule 22 comment rot)",
    ).toEqual([]);
  });

  it("no file under src/, tests/ or src-tauri/ names the symbol at all", () => {
    const hits = swept.flatMap(mentions);
    expect(
      hits,
      "the fourth slug generator, or a claim that one exists, is back in the tree",
    ).toEqual([]);
  });

  it("its file-mate buildTOCHierarchy survives, still re-exported from tocStore", () => {
    expect(typeof buildTOCHierarchy).toBe("function");
    const entry = (n: number, level: 1 | 2, text: string): TOCEntry => ({
      key: asHeadingKey(`hk-${n}`),
      anchorSlug: asAnchorSlug(text.toLowerCase()),
      level,
      text,
      lineNumber: n,
      offset: n * 10,
      children: [],
    });
    const flat: TOCEntry[] = [entry(1, 1, "A"), entry(2, 2, "B")];
    const nested = buildTOCHierarchy(flat);
    expect(nested).toHaveLength(1);
    expect(nested[0].children.map((c) => c.text)).toEqual(["B"]);
  });
});
