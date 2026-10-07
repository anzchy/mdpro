// @vitest-environment node
/**
 * D46 WI-3 / case D46-C1 (spec adversary, round 1) — the `App.tsx` open callers do
 * not report a failed open themselves.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261003-130127.md` § WI-3, case D46-C1.
 *
 * Since WI-2, `useDocument().openDocumentFromPath` is the single reporter of a
 * non-encoding open failure (`reportOpenFailure()` → one `OPEN_FAILED_MESSAGE` toast).
 * A caller that added its own toast or reporter would emit twice. The toast store
 * replaces rather than stacks, so a device check (M-2, M-4) cannot see the duplicate;
 * this file is the only guard on the four callers that have no render harness.
 *
 * ── SPEC LEVEL: SOURCE-TEXT INSPECTION ─────────────────────────────────────
 *
 * These cases read `src/App.tsx` off disk and match it as text, following
 * `tests/large-document-guard-call-site.test.ts`. No test renders `App` (see the
 * waiver recorded there). This file cannot prove a callback runs, only that its
 * body contains no second reporter. It replaces the WI-3 `git diff | grep showToast`
 * check, which a bare `reportOpenFailure()` call would have evaded.
 *
 * Each callback is sliced from `const <name> = useCallback(` to the end of its
 * dependency array. A callback that is renamed or reshaped so the slice cannot be
 * found fails loudly, rather than leaving an empty slice that matches nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Same resolution as tests/large-document-guard-call-site.test.ts: under vitest's
// transform import.meta.url is not a file:// URL, so resolve from the test path.
function readApp(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  return fs.readFileSync(path.resolve(path.dirname(testPath), "../src/App.tsx"), "utf-8");
}

/** End of a `useCallback(...)` call: its dependency array, then `)` and `;`. */
const DEPENDENCY_ARRAY_END = /\]\s*,?\s*\)\s*;/;

/** The body of `const <name> = useCallback(` through its dependency array. Throws if absent. */
function callbackSlice(src: string, name: string): string {
  const anchor = `const ${name} = useCallback(`;
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`App.tsx: '${anchor}' not found; the D46-C1 slice cannot be taken`);
  if (src.indexOf(anchor, start + anchor.length) >= 0) {
    throw new Error(`App.tsx: '${anchor}' occurs more than once`);
  }
  const rest = src.slice(start);
  const end = rest.search(DEPENDENCY_ARRAY_END);
  if (end < 0) throw new Error(`App.tsx: no dependency array after '${anchor}'`);
  const slice = rest.slice(0, end);
  // The slice is this callback and has not swallowed a neighbour.
  expect(slice.match(/useCallback\(/g) ?? [], name).toHaveLength(1);
  return slice;
}

const count = (src: string, needle: string): number => src.split(needle).length - 1;

const NO_REPORT_CALLERS = ["handleOpenPath", "openPaths", "handleOpenRecent", "handleFileDrop"] as const;

describe("D46-C1 — App.tsx open callers do not report a failure themselves", () => {
  it.each(NO_REPORT_CALLERS)("%s adds no toast or reporter of its own", (name) => {
    const slice = callbackSlice(readApp(), name);
    expect(slice.length, name).toBeGreaterThan(0);
    expect(slice, name).not.toMatch(/reportOpenFailure|showToast|OPEN_FAILED_MESSAGE|useToastStore/);
  });

  it("App.tsx never calls reportOpenFailure", () => {
    expect(count(readApp(), "reportOpenFailure")).toBe(0);
  });

  it("OPEN_FAILED_MESSAGE appears exactly twice: the import and the handleOpenDialog catch", () => {
    const src = readApp();
    expect(count(src, "OPEN_FAILED_MESSAGE")).toBe(2);
    expect(src).toMatch(/import\s*\{\s*OPEN_FAILED_MESSAGE\s*\}\s*from\s*"\.\/utils\/openFailure"/);
  });

  it("showToast(OPEN_FAILED_MESSAGE) occurs once in the file, inside handleOpenDialog", () => {
    const src = readApp();
    const needle = "showToast(OPEN_FAILED_MESSAGE)";
    expect(count(src, needle)).toBe(1);
    expect(count(callbackSlice(src, "handleOpenDialog"), needle)).toBe(1);
  });
});

// Review follow-up: a slice cut short (e.g. by an inner `]);` before the real
// dependency array) would contain nothing and so pass the no-reporter check
// vacuously. Each slice must reach a call that only its real body makes.
const SLICE_ANCHORS: ReadonlyArray<[name: (typeof NO_REPORT_CALLERS)[number], anchor: string]> = [
  ["handleOpenPath", "openDocumentFromPath("],
  ["openPaths", "openDocumentFromPath("],
  ["handleOpenRecent", "handleOpenPath("],
  ["handleFileDrop", "handleOpenPath("],
];

describe("D46-C1 — each caller slice reaches its real body", () => {
  it("every no-report caller has an anchor", () => {
    expect(SLICE_ANCHORS.map(([name]) => name)).toEqual([...NO_REPORT_CALLERS]);
  });

  it.each(SLICE_ANCHORS)("%s slice contains %s", (name, anchor) => {
    const slice = callbackSlice(readApp(), name);
    expect(count(slice, anchor), `${name} → ${anchor}`).toBeGreaterThanOrEqual(1);
  });
});
