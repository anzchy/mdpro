// @vitest-environment node
/**
 * D95 ② — App's open follow-ups run only for an open whose document became active.
 *
 * A D92-refused open still writes its tab (inactive). Before D95, App applied the
 * default view mode after any open that returned a document, so with a Source default
 * and a flush that still fails one drop or Finder open was refused twice (two toasts),
 * and `file.open.drop` said `success` with no sign of the refusal.
 *
 * Decided behaviour:
 * - `handleOpenPath` and `openPaths` open through `useDocument().openPathOutcome`,
 *   which resolves to `{ document, activated }`.
 * - The recent-files update still happens for every open that opened (the file did
 *   open); only the view-mode follow-up waits for `activated`.
 * - `file.open.drop` keeps `success` / `fail` meaning "the open happened" (as the
 *   guard's own logs do, ADR-0071 decision 3) and adds `context.activated`.
 *
 * ── SPEC LEVEL: SOURCE-TEXT INSPECTION ─────────────────────────────────────
 * No test renders `App` (waiver: tests/large-document-guard-call-site.test.ts). The
 * behaviour of `openPathOutcome` and of the gate is driven through the real hook in
 * `tests/d95-open-activation.test.tsx`; this file pins that App wires that gate.
 * Comments are stripped before matching.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readApp(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  return fs.readFileSync(path.resolve(path.dirname(testPath), "../src/App.tsx"), "utf-8");
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const DEPENDENCY_ARRAY_END = /\]\s*,?\s*\)\s*;/;

function callbackSlice(src: string, name: string): string {
  const anchor = `const ${name} = useCallback(`;
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`App.tsx: '${anchor}' not found`);
  const rest = src.slice(start);
  const end = rest.search(DEPENDENCY_ARRAY_END);
  if (end < 0) throw new Error(`App.tsx: no dependency array after '${anchor}'`);
  const slice = rest.slice(0, end);
  expect(slice.match(/useCallback\(/g) ?? [], name).toHaveLength(1);
  return slice;
}

const app = () => stripComments(readApp());

describe("D95 ② handleOpenPath / openPaths open through openPathOutcome", () => {
  it.each(["handleOpenPath", "openPaths"])("%s calls openPathOutcome, not openDocumentFromPath", (name) => {
    const s = callbackSlice(app(), name);
    expect(s).toMatch(/\bopenPathOutcome\(/);
    expect(s).not.toMatch(/\bopenDocumentFromPath\(/);
  });

  it.each(["handleOpenPath", "openPaths"])("%s records the recent file for every open that opened, ungated by activation", (name) => {
    const s = callbackSlice(app(), name);
    expect(s).toMatch(/if\s*\(\s*opened\?\.document\.path\s*\)\s*\{?\s*updateRecentFiles\(opened\.document\.path\)/);
  });

  it("openPaths invokes onOpened only when the document became active", () => {
    const s = callbackSlice(app(), "openPaths");
    expect(s.match(/onOpened\??\.?\(\)/g) ?? []).toHaveLength(1);
    expect(s).toMatch(/if\s*\(\s*opened\?\.activated\s*\)\s*\{?\s*onOpened\?\.\(\)/);
  });
});

describe("D95 ② handleFileDrop", () => {
  it("applies the default view mode only when the dropped file became active", () => {
    const s = callbackSlice(app(), "handleFileDrop");
    expect(s).toMatch(/if\s*\(\s*opened\?\.activated\s*\)\s*\{?\s*applyDefaultViewMode\(\)/);
    expect(s.match(/applyDefaultViewMode\(\)/g) ?? []).toHaveLength(1);
  });

  it("the file.open.drop outcome log records whether the document became active", () => {
    const s = callbackSlice(app(), "handleFileDrop");
    const outcomeLog = s.slice(s.lastIndexOf('event: "file.open.drop"'));
    expect(outcomeLog).toMatch(/status:\s*opened\s*\?\s*"success"\s*:\s*"fail"/);
    expect(outcomeLog).toMatch(/activated:\s*opened\?\.activated\s*\?\?\s*false/);
  });
});
