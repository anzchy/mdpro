// @vitest-environment node
// GH629-T2 fix 3: the README's changed-fold form holds the five post-rebase lines without weakening ADR pins.
import { describe, expect, it } from "vitest";
import { ADR, addStatusParagraph, heldBody, isFormExempt, isForwardLink, read, sha, statusParagraphs, unresolvedCurrentText } from "./d355-fix1-lib";

// ADR-0085's existing forward links and accepted-body pin, recorded by the #629 pin tests.
const BASE_0085 = [
  "c306ace53e16f5b721f330f5524952c579f5976d0bac39331ffa13a43c7c8561",
  "d15a5b9dd34c7329ca8b188b43a0313fb5f22dc0d99ba3ba6eee1cb8ba0c4dec",
];
const PIN_0085 = "e82b18283bc1d7295ff05028a7b31894994bfed61b53bbe7d83ed00a3afce251";
const original = read(ADR("0085"));
const valid = "Current text: `docs/adr/README.md#writing-and-changing-an-adr`; folded and changed by `docs/agents/decisions/20261104-adr-bar-raised.md` (2026-11-04, decision 3 only).";
const withStatus = (paragraph: string) => addStatusParagraph(original, paragraph);
const bodyPin = (paragraph: string) => sha(heldBody(withStatus(paragraph), BASE_0085).body);

describe("GH629-T2 fix 3 changed-fold Current-text form", () => {
  it("accepts all five post-rebase Status lines without exemptions", () => {
    for (const id of ["0125", "0129", "0145", "0149", "0162"]) {
      const line = statusParagraphs(read(ADR(id))).find((p) => p.startsWith("Current text:") && p.includes("20261104-receipts-are-audit-evidence.md"));
      expect(line, id).toBeDefined();
      expect(isFormExempt(id, line!), id).toBe(false);
      expect(isForwardLink(line!, id), id).toBe(true);
    }
  });

  it("accepts another resolved changed-fold line and leaves ADR-0085's body pin unchanged", () => {
    expect(sha(heldBody(original, BASE_0085).body)).toBe(PIN_0085);
    expect(isForwardLink(valid, "0085")).toBe(true);
    expect(heldBody(withStatus(valid), BASE_0085).missing).toEqual([]);
    expect(bodyPin(valid)).toBe(PIN_0085);
  });

  it.each([
    ["missing decision file", valid.replace("20261104-adr-bar-raised.md", "20991231-none.md")],
    ["undated parenthetical", valid.replace("(2026-11-04, decision 3 only)", "(decision 3 only)")],
    ["trailing prose", `${valid} Decision 1 is void.`],
    ["heading line", `${valid}\n# Decision`],
    ["empty scope", valid.replace("decision 3 only", "")],
    ["second parenthetical", valid.replace("decision 3 only).", "decision 3 only) (extra).")],
    ["missing terminal period", valid.slice(0, -1)],
    ["decision path escapes to an ADR", valid.replace("20261104-adr-bar-raised.md", "../../adr/README.md")],
    ["decision path escapes to the repository root", valid.replace("20261104-adr-bar-raised.md", "../../../CLAUDE.md")],
    ["impossible month and day", valid.replace("2026-11-04", "2026-99-99")],
    ["impossible calendar day", valid.replace("2026-11-04", "2026-13-45")],
    ["year zero and day zero", valid.replace("2026-11-04", "0000-00-00")],
    ["future date", valid.replace("2026-11-04", "2099-12-31")],
    ["whitespace-only scope", valid.replace("decision 3 only", " ")],
    ["scope split across lines", valid.replace("decision 3 only", "decision 3\nonly")],
  ])("rejects %s and keeps the addition inside ADR-0085's body pin", (_name, paragraph) => {
    expect(isForwardLink(paragraph, "0085")).toBe(false);
    expect(heldBody(withStatus(paragraph), BASE_0085).missing).toEqual([]);
    expect(bodyPin(paragraph)).not.toBe(PIN_0085);
  });

  it("rejects the same path and date holes in the older route form while keeping ADR-0085 pinned", () => {
    const older = "**Current text: `docs/adr/README.md#the-bar`; folded and changed by [`docs/agents/decisions/20261104-adr-bar-raised.md`](../agents/decisions/20261104-adr-bar-raised.md)**, 2026-11-04.";
    expect(isForwardLink(older, "0085")).toBe(true);
    for (const bad of [
      older.replaceAll("20261104-adr-bar-raised.md", "../../../CLAUDE.md"),
      older.replace("../agents/decisions/20261104-adr-bar-raised.md", "../agents/decisions/../../../CLAUDE.md"),
      older.replace("2026-11-04.", "2026-99-99."),
    ]) {
      expect(isForwardLink(bad, "0085")).toBe(false);
      expect(bodyPin(bad)).not.toBe(PIN_0085);
    }
  });

  it("reports a missing decision file through the target checker", () => {
    const missing = valid.replace("20261104-adr-bar-raised.md", "20991231-none.md");
    expect(unresolvedCurrentText("fixture", withStatus(missing)).bad).toEqual([
      "fixture: docs/agents/decisions/20991231-none.md: file missing",
    ]);
  });

  it("still rejects a missing target anchor", () => {
    const missing = valid.replace("#writing-and-changing-an-adr", "#no-such-heading");
    expect(isForwardLink(missing, "0085")).toBe(false);
    expect(unresolvedCurrentText("fixture", withStatus(missing)).bad).toEqual([
      "fixture: docs/adr/README.md#no-such-heading: anchor missing",
    ]);
    expect(bodyPin(missing)).not.toBe(PIN_0085);
  });
});
