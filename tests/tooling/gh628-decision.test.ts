// @vitest-environment node
// GH628-S2: the decision records the reviewed rationale and routes receipt flags as advisory evidence.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const entryPath = "docs/agents/decisions/20261104-receipts-are-audit-evidence.md";
const entry = () => existsSync(resolve(root, entryPath)) ? read(entryPath) : "";

describe("GH628-S2 reviewed decision", () => {
  it("names every superseded clause while preserving the receipt route", () => {
    const text = entry();
    for (const clause of ["ADR-0125 d5", "ADR-0129 d8", "ADR-0145 d2", "ADR-0145 d3", "ADR-0145 d4", "ADR-0145 d5", "ADR-0145 d6", "ADR-0145 d7", "ADR-0149 d2", "ADR-0149 d3", "ADR-0149 d4", "ADR-0149 d6", "ADR-0149 d7", "ADR-0162 d1"]) {
      expect(text, clause).toContain(clause);
    }
    expect(text).toContain("20261102-receipts-per-item-files.md");
    expect(text).toContain("ADR-0161 d7");
    expect(text).toContain("per-cycle recording and verification");
    expect(text).toContain("0.3.6 shipped");
    expect(text).toContain("「Fable A′ (Recommended)」");
    expect(text).toContain("「把 A′ 决定提交作为一个github issue，附上合适标签和link doc，然后再发给auditor审计，审计完排在最优先级实施」");
  });

  it("states the accepted costs and the separate CI question", () => {
    const text = entry();
    expect(text).toContain("intentional byte-immutability and canonical-shape policy");
    expect(text).toContain("D318-F1-2");
    expect(text).toMatch(/2026-10-30[^\n]*38[^\n]*25/);
    expect(text).toMatch(/D357[^\n]*audit[^\n]*wait/i);
    expect(text).toContain("separate rule-12 item");
    expect(text).toMatch(/selection[^\n]*blocking status/);
    expect(text).toMatch(/base collect, compile or missing-module failure is inconclusive/);
    expect(text).toContain("fails without the fix?");
    const summary = text.split("- **Decision:**")[0];
    expect(summary.match(/[.!?](?:\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it("sends flagged ids and RED-pin to head diffs as advice, with replay only on auditor request", () => {
    const request = read(".agents/skills/mdpro-delegator/references/templates/audit-request-template.md");
    const guide = read("docs/guide/receipt-evidence.md");
    expect(request).toContain("Known qualifications");
    expect(request).toContain("check-pending");
    expect(request).toContain("RED-pin");
    expect(request).toContain("advisory");
    expect(guide).toContain("delegator runs `replay` when an auditor asks");
    expect(guide).toContain("ADR-0161 d7");
  });

  it("adds forward links without changing accepted ADR bodies", () => {
    for (const id of ["0125", "0129", "0145", "0149", "0162"]) {
      const path = ["0125-frontend-red-receipts-run-one-validated-test-file-not-the-full-coverage-lane.md", "0129-a-high-that-survives-the-audit-cap-is-classified-tracked-and-expires.md", "0145-a-broken-red-receipt-carries-its-own-evidence-and-the-auditors-rule-on-it.md", "0149-a-broken-receipt-is-judged-by-a-base-tree-fail-to-pass-replay.md", "0162-rework-countermeasures-before-0-3-6-and-a-process-freeze.md"].find((p) => p.startsWith(id))!;
      const text = read(`docs/adr/${path}`);
      expect(text, id).toContain("Current text:");
      expect(text, id).toContain("20261104-receipts-are-audit-evidence.md");
    }
  });
});
