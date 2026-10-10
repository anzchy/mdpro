/**
 * D20 / WI-3 — the encoding-reopen refusal toast (ADR-0028).
 *
 * Unit C of tests-20260924-105300.md:
 *   C-1  refused-dirty → exactly one toast, no recent-files update
 *   C-2  opened → no toast, recent path is the document's path (or null)
 *   C-3  App.tsx handleEncodingSelect applies the mapper (source contract,
 *        weak by design — follows the tests/focus-trap.test.ts precedent)
 *
 * No law: a total lookup over a two-variant union. Exhaustiveness is enforced
 * by `satisfies never` at compile time (tsc), not here.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { encodingReopenOutcome } from "../src/utils/openWriteGuard";
import type { Document } from "../src/types/document";

function doc(p: string | null): Document {
  return {
    id: "doc-t",
    path: p,
    content: "body",
    encoding: "gbk",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: 4,
  };
}

describe("encodingReopenOutcome (Unit C)", () => {
  it("C-1 refused-dirty maps to exactly one toast and no recent-files update", () => {
    const outcome = encodingReopenOutcome({ kind: "refused-dirty", documentId: "doc-t" });
    expect(outcome).toEqual({
      toast: "Kept your unsaved changes; the file was not re-decoded",
      recentPath: null,
      clearIssue: true,
    });
    expect(outcome.toast).toMatch(/unsaved changes/);
  });

  it("C-2 opened with a path maps to no toast and that path", () => {
    expect(encodingReopenOutcome({ kind: "opened", document: doc("/tmp/t.md") })).toEqual({
      toast: null,
      recentPath: "/tmp/t.md",
      clearIssue: true,
    });
  });

  it("C-2 opened with path null maps to no toast and no recent path", () => {
    expect(encodingReopenOutcome({ kind: "opened", document: doc(null) })).toEqual({
      toast: null,
      recentPath: null,
      clearIssue: true,
    });
  });
});

describe("App.tsx handleEncodingSelect applies the mapper (C-3, source contract)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf-8");
  const start = src.indexOf("const handleEncodingSelect");
  const end = src.indexOf("useCallback(", src.indexOf("useCallback(", start) + 1);
  const slice = start >= 0 && end > start ? src.slice(start, end) : "";

  it("slices a non-empty handler", () => {
    expect(slice.length).toBeGreaterThan(0);
  });

  it("calls the mapper, clears the encoding issue, and keeps the failure toast", () => {
    expect(slice).toContain("encodingReopenOutcome(");
    expect(slice).toContain("clearEncodingIssue()");
    expect(slice).toContain('"Failed to open with selected encoding"');
  });

  it("has no bare showToast(\"…\") other than the failure toast", () => {
    const literals = slice.match(/showToast\("[^"]*"\)/g) ?? [];
    expect(literals).toEqual(['showToast("Failed to open with selected encoding")']);
  });
});
