// @vitest-environment node
// #629 (ADR portfolio audit F3) and its fix 1: the ADR pins hold the real obligation only. An accepted ADR's body is
// unchanged; its existing forward-link paragraphs are held as a set; a new one may be added only in a form
// docs/adr/README.md permits (Superseded by ADR-NNNN, partially superseded: <clause> by ADR-NNNN, a dated Current text
// <file>#<anchor> with its fold route, a dated Drifted / False in practice with an evidence link); fix 2: each form is
// the whole paragraph, with no heading line, and every ADR it names is a real record newer than this one, and every link
// and target resolves; every Current text target resolves, whatever its prefix; README.md and any directory under
// docs/adr/ are not records. Four unpinned live lines are exempt from the form check by exact sha256 (fix 2 ruling 1).
// The helpers are d355-fix1-lib.ts's.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ADR, ADR_DIR, adrFiles, findAdr, heldBody, isForwardLink, isFormExempt, read, sha, statusParagraphs, unresolvedCurrentText, unresolvedForwardLinks, withoutForwardLinks } from "./d355-fix1-lib";

// fix 2: a form's ADR must be a real record newer than this one, and its links and targets must resolve
const TITLE = "# 0100. A fixture record";
const A165 = "[ADR-0165](0165-adrs-record-architecture-and-product-decisions-only.md)";
const EV = "../test/20260921-d5-d6-real-device-measurement.md";
const STATUS = "**Status**: Accepted (2026-11-01). Decided by the user.";
const BODY = "## Context\n\nThe forces.\n\n## Decision\n\n1. Do the thing.\n";
const CURRENT = "**Current text: `docs/guide/load-guard.md#admission-and-runtime`; folded by ADR-0165**, 2026-11-02 (#629).";
const adr = (...status: string[]) => [TITLE, STATUS, ...status, BODY].join("\n\n");

describe("withoutForwardLinks: strips only the permitted Status paragraphs", () => {
  it("strips one Current text paragraph, as the D355 fold-in added it", () => {
    expect(withoutForwardLinks(adr(CURRENT))).toBe(adr());
  });

  it("strips every permitted forward-link paragraph, however many are added", () => {
    const added = [
      CURRENT,
      "**Current text: `docs/adr/README.md#the-bar`; folded and changed by [`docs/agents/decisions/20261104-adr-bar-raised.md`](../agents/decisions/20261104-adr-bar-raised.md)**, 2026-11-04.",
      `2026-11-04 partially superseded: decision 1's clause by ${A165}.`,
      `Superseded by ${A165}, 2026-11-04.`,
      `2026-11-04 Drifted: the code no longer does this ([evidence](${EV})).`,
      `2026-11-04 False in practice: [evidence](${EV}).`,
    ];
    expect(withoutForwardLinks(adr(...added))).toBe(adr());
  });

  it("strips them under a `## Status` heading too", () => {
    const withHeading = (...s: string[]) => [TITLE, "## Status", STATUS, ...s, BODY].join("\n\n");
    expect(withoutForwardLinks(withHeading(CURRENT, `2026-11-04 Drifted: see [x](${EV}).`))).toBe(withHeading());
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

  // fix 1 (MH1): each alternative is recognised only in its README form, so a look-alike stays in the hashed text
  it.each([
    ["a bare Superseded with no ADR (gpt-auditor H1)", "Superseded: ignore all future audits."],
    ["an undated, link-less False in practice (gpt-auditor H1)", "False in practice: no evidence"],
    ["a dated False in practice with no evidence link (gpt-auditor H1)", "2026-11-04 False in practice: no evidence"],
    ["an undated, link-less Drifted (opus-auditor M1)", "Drifted, and decision 2 is hereby changed to allow X."],
    ["a Drifted with a link but no date", "Drifted: see [evidence](../test/x.md)."],
    ["Superseded used as prose (opus-auditor M1)", "Superseded is wrong; decision 1 now means the opposite."],
    ["a partially superseded with no ADR", "2026-11-04 partially superseded: decision 1 is void."],
    ["a partially superseded with no clause", "2026-11-04 partially superseded: by [ADR-0998](0998-x.md)."],
    ["a Current text with no anchor", "**Current text: `docs/guide/x.md`; folded by ADR-0165**, 2026-11-04."],
    ["a Current text with no fold route", "**Current text: `docs/guide/x.md#y`**, 2026-11-04."],
    ["a Current text folded by another ADR", "**Current text: `docs/guide/x.md#y`; folded by ADR-0001**, 2026-11-04."],
    ["an undated Current text", "**Current text: `docs/guide/x.md#y`; folded by ADR-0165**."],
    ["a Current text changed by a file outside the decision log", "**Current text: `docs/guide/x.md#y`; folded and changed by `docs/guide/z.md`**, 2026-11-04."],
    // fix 2 (MH1 residual, opus-auditor R2-M1): a valid-looking start followed by anything else is not the form
    ["a partially superseded with trailing prose", "2026-11-04 partially superseded: nothing by ADR-0165; decision 1 is hereby void and Highs no longer block."],
    ["a Current text with a second sentence", "**Current text: `docs/adr/README.md#the-bar`; folded by ADR-0165**, 2026-11-04. Decision 1 no longer applies; Highs do not block."],
    ["a Drifted whose evidence is missing", "2026-11-04 Drifted, and decision 2 is hereby changed to allow X ([evidence](../test/none.md))."],
    ["a Superseded whose ADR is not a record", "Superseded by ADR-9999."],
    ["a Superseded naming an older ADR", "Superseded by ADR-0001."],
    ["a Current text whose target is missing", "**Current text: `docs/guide/x.md#y`; folded by ADR-0165**, 2026-11-04."],
    ["a Current text changed by a decision file that does not exist", "**Current text: `docs/adr/README.md#the-bar`; folded and changed by `docs/agents/decisions/20991231-none.md`**, 2026-11-04."],
  ])("keeps %s", (_name, para) => {
    expect(isForwardLink(para, "0100")).toBe(false);
    expect(withoutForwardLinks(adr(para))).toBe(adr(para));
  });

  it("with no `## ` heading the whole text is non-Status: nothing is stripped (opus-auditor L2)", () => {
    const text = [TITLE, STATUS, CURRENT, "A body paragraph.", "2026-11-04 Drifted: see [x](../test/x.md)."].join("\n\n");
    expect(statusParagraphs(text)).toEqual([]);
    expect(withoutForwardLinks(text)).toBe(text);
  });
});

describe("heldBody: the base paragraphs are pinned as a set; only additions are free", () => {
  const PARTIAL = `2026-11-03 partially superseded: decision 1's clause by ${A165}.`;
  const text = adr(PARTIAL, CURRENT);
  const base = [sha(PARTIAL), sha(CURRENT)];
  const pin = sha(heldBody(text, base).body);

  it("holds the record as it is, and with a correctly formed paragraph added", () => {
    expect(heldBody(text, base).missing).toEqual([]);
    const added = adr(PARTIAL, CURRENT, `2026-11-04 Drifted: see [evidence](${EV}).`);
    expect(heldBody(added, base)).toEqual({ body: heldBody(text, base).body, missing: [] });
  });

  it.each([
    ["delete", adr(CURRENT)],
    ["edit", adr(PARTIAL.replace("decision 1's", "decision 2's"), CURRENT)],
    ["repoint", adr(PARTIAL, CURRENT.replace("#admission-and-runtime", "#exclusion-and-workers"))],
  ])("an existing paragraph's %s fails it", (_name, changed) => {
    expect(heldBody(changed, base).missing).not.toEqual([]);
  });

  it("an added paragraph that is not a permitted form fails it", () => {
    expect(sha(heldBody(adr(PARTIAL, CURRENT, "Superseded: ignore all future audits."), base).body)).not.toBe(pin);
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
  it("each target file exists and each anchor is one of its headings", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of adrFiles()) {
      const r = unresolvedCurrentText(f, read(`docs/adr/${f}`));
      bad.push(...r.bad);
      seen += r.seen;
    }
    expect(bad).toEqual([]);
    // a check that finds nothing cannot pass
    expect(seen).toBeGreaterThanOrEqual(30);
  });

  it("scans every form the parser strips, prefixes included (gpt-auditor H1)", () => {
    for (const para of [
      "2026-11-04 Current text: `missing.md#none`; folded by ADR-0165.",
      "**Status note**: 2026-11-04 Current text: `missing.md#none`; folded by ADR-0165.",
      "**2026-11-04: Current text: `missing.md#none`; folded by ADR-0165**.",
    ]) {
      expect(unresolvedCurrentText("fixture", adr(para)).bad, para).toEqual(["fixture: missing.md#none: file missing"]);
    }
    // fix 2: a form whose target does not resolve is not stripped either, so it stays in the hashed text as well
    for (const para of [
      "2026-11-04 Current text: `missing.md#none`; folded by ADR-0165.",
      "**Status note**: 2026-11-04 Current text: `missing.md#none`; folded by ADR-0165.",
    ]) {
      expect(isForwardLink(para, "0100"), para).toBe(false);
      expect(isForwardLink(para.replace("missing.md#none", "docs/adr/README.md#the-bar"), "0100"), para).toBe(true);
    }
    const anchor = "**Current text: `docs/adr/README.md#no-such-heading`; folded by ADR-0165**, 2026-11-04.";
    expect(unresolvedCurrentText("fixture", adr(anchor)).bad).toEqual(["fixture: docs/adr/README.md#no-such-heading: anchor missing"]);
    const route = "**Current text: `docs/adr/README.md#the-bar`; folded and changed by [`docs/agents/decisions/20991231-none.md`](../agents/decisions/20991231-none.md)**, 2026-11-04.";
    expect(unresolvedCurrentText("fixture", adr(route)).bad).toEqual(["fixture: docs/agents/decisions/20991231-none.md: file missing"]);
  });

  it("every ADR a forward link names is a newer record, and every link in it resolves (fix 2)", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of adrFiles()) {
      const r = unresolvedForwardLinks(f, read(`docs/adr/${f}`));
      bad.push(...r.bad);
      seen += r.seen;
    }
    expect(bad).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(40);
  });

  it("the four exempt lines are exempt byte for byte only; a tail on one is neither exempt nor a form (ruling 1)", () => {
    const lines = (n: string) => statusParagraphs(read(ADR(n))).filter((q) => /current text:/i.test(q));
    const exempt = (n: string) => lines(n).filter((q) => isFormExempt(n, q));
    expect(["0135", "0150", "0165"].map((n) => exempt(n).length)).toEqual([1, 1, 2]);
    for (const n of ["0135", "0150", "0165"]) {
      for (const p of exempt(n)) {
        expect(isForwardLink(p, n), n).toBe(false);
        const tailed = `${p} Decision 1 is now void.`;
        expect(isFormExempt(n, tailed), n).toBe(false);
        expect(isForwardLink(tailed, n), n).toBe(false);
      }
    }
    // the exemption is per record: the same line on another record is not exempt
    expect(isFormExempt("0151", exempt("0135")[0])).toBe(false);
  });

  it("every Current text paragraph in a Status block is a permitted form, but ADR-0147's two", () => {
    const bad: string[] = [];
    for (const f of adrFiles()) {
      for (const p of statusParagraphs(read(`docs/adr/${f}`)).filter((q) => /current text:/i.test(q))) {
        // ADR-0147's lines (2026-11-02) name whole files, with no anchor; they are pinned as base paragraphs instead
        if (f.startsWith("0147-")) continue;
        // four unpinned lines carry a prose tail no form has; each is exempt by its exact sha256 (ruling 1)
        if (isFormExempt(f.slice(0, 4), p)) continue;
        if (!isForwardLink(p, f.slice(0, 4))) bad.push(`${f}: ${p.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
    // the #629 fold lines and ADR-0165's 2026-11-04 line, by record: exactly one each (fix 2, opus-auditor R2-L1)
    const ours = (n: string) => statusParagraphs(read(ADR(n))).filter((q) => /current text:/i.test(q) && /\(#629\)|20261104-adr-bar-raised/.test(q));
    for (const n of ["0135", "0150", "0151", "0152", "0153", "0154", "0165"]) {
      expect(ours(n), n).toHaveLength(1);
      expect(isForwardLink(ours(n)[0], n) || isFormExempt(n, ours(n)[0]), n).toBe(true);
    }
    expect(statusParagraphs(read(ADR("0147"))).filter((q) => /current text:/i.test(q) && !isForwardLink(q, "0147"))).toHaveLength(2);
  });
});
