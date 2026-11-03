// @vitest-environment node
// #629 (ADR portfolio audit F3): the ADR pins hold the real obligation only. An accepted ADR's body is unchanged; the
// forward-link paragraphs docs/adr/README.md permits (Superseded by / partially superseded, Current text … folded
// [and changed] by, dated Drifted / False in practice) may be added; a forward link resolves; README.md and any
// directory under docs/adr/ are not records. The helpers are d355-fix1-lib.ts's.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ADR_DIR, adrFiles, anchorExists, exists, findAdr, read, withoutForwardLinks } from "./d355-fix1-lib";

const TITLE = "# 0999. A fixture record";
const STATUS = "**Status**: Accepted (2026-11-01). Decided by the user.";
const BODY = "## Context\n\nThe forces.\n\n## Decision\n\n1. Do the thing.\n";
const CURRENT = "**Current text: `docs/guide/x.md#y`; folded by ADR-0165**, 2026-11-02 (entry).";
const adr = (...status: string[]) => [TITLE, STATUS, ...status, BODY].join("\n\n");

describe("withoutForwardLinks: strips only the permitted Status paragraphs", () => {
  it("strips one Current text paragraph, as the D355 fold-in added it", () => {
    expect(withoutForwardLinks(adr(CURRENT))).toBe(adr());
  });

  it("strips every permitted forward-link paragraph, however many are added", () => {
    const added = [
      CURRENT,
      "**Current text: `docs/guide/z.md#w`; folded and changed by [`docs/agents/decisions/20261104-x.md`](../agents/decisions/20261104-x.md)**, 2026-11-04.",
      "2026-11-04 partially superseded: decision 1's clause by [ADR-0998](0998-x.md).",
      "Superseded by [ADR-0998](0998-x.md), 2026-11-04.",
      "2026-11-04 Drifted: the code no longer does this ([evidence](../test/x.md)).",
      "2026-11-04 False in practice: [evidence](../test/y.md).",
    ];
    expect(withoutForwardLinks(adr(...added))).toBe(adr());
  });

  it("strips them under a `## Status` heading too", () => {
    const withHeading = (...s: string[]) => [TITLE, "## Status", STATUS, ...s, BODY].join("\n\n");
    expect(withoutForwardLinks(withHeading(CURRENT, "2026-11-04 Drifted: see [x](../test/x.md)."))).toBe(withHeading());
  });

  it("keeps the Status line, a backward Supersedes paragraph and any other Status prose", () => {
    const kept = adr("Supersedes [ADR-0001](0001-x.md) decision 2.", "Revised after round 1: C0 H1.");
    expect(withoutForwardLinks(kept)).toBe(kept);
  });

  it("never strips a look-alike paragraph inside the body", () => {
    const text = [TITLE, STATUS, BODY, CURRENT, "## Consequences\n\nNone."].join("\n\n");
    expect(withoutForwardLinks(text)).toBe(text);
  });

  it("a changed body byte still changes the result (mutation guard)", () => {
    expect(withoutForwardLinks(adr(CURRENT).replace("Do the thing", "Do the thinG"))).not.toBe(adr());
  });
});

describe("the ADR directory readers skip entries that are not records", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-dir-"));
  fs.mkdirSync(path.join(dir, "0161-a-directory"));
  fs.writeFileSync(path.join(dir, "0161-the-record.md"), "# 0161.\n");
  fs.writeFileSync(path.join(dir, "0162-other.md"), "# 0162.\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# ADRs\n");
  fs.mkdirSync(path.join(dir, "archive"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("adrFiles lists only NNNN-*.md files, sorted", () => {
    expect(adrFiles(dir)).toEqual(["0161-the-record.md", "0162-other.md"]);
  });

  it("findAdr resolves to the record file, not a directory with the same prefix", () => {
    expect(findAdr(dir, "0161")).toBe("0161-the-record.md");
    expect(findAdr(dir, "0163")).toBeUndefined();
  });

  it("the live docs/adr/ readers see every record and no README", () => {
    const all = fs.readdirSync(ADR_DIR).filter((f) => /^\d{4}-.+\.md$/.test(f));
    expect(adrFiles()).toEqual(all.sort());
    expect(adrFiles()).not.toContain("README.md");
  });
});

describe("every Current text forward link in docs/adr/ resolves (live tree)", () => {
  // the backticked `path` or `path#anchor` targets between "Current text:" and "; folded"
  const targets = (line: string) =>
    [...(line.match(/Current text: (.*?); folded/)?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);

  it("each target file exists and each anchor is one of its headings", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of adrFiles()) {
      for (const line of read(`docs/adr/${f}`).split("\n").filter((l) => l.startsWith("**Current text:"))) {
        for (const t of targets(line)) {
          seen++;
          const [file, anchor] = t.split("#");
          if (!exists(file)) bad.push(`${f}: ${t}: file missing`);
          else if (anchor && !anchorExists(file, anchor)) bad.push(`${f}: ${t}: anchor missing`);
        }
      }
    }
    expect(bad).toEqual([]);
    // a check that finds nothing cannot pass
    expect(seen).toBeGreaterThanOrEqual(30);
  });
});
