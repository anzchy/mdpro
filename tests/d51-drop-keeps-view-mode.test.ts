// @vitest-environment node
/**
 * D51 — a drop (or a Finder `open -a` while running) whose open fails must not
 * flip the window's view mode. Before the fix, `handleFileDrop` and
 * `handleFileOpenEvent` called `setViewMode(defaultViewMode)` before opening, so
 * a rejected file (e.g. > 10 MiB) still switched Source → WYSIWYG and loaded the
 * CURRENT document into WYSIWYG, where surplus table cells are lost at load
 * (ADR-0063).
 *
 * Decided behaviour: open first; apply the default view mode exactly once, right
 * after the first file that opened. All fail → view mode untouched. The cold
 * launch path (`checkLaunchPaths`) is deliberately unchanged: there is no current
 * document to protect.
 *
 * ── SPEC LEVEL: SOURCE-TEXT INSPECTION ─────────────────────────────────────
 *
 * No test renders `App` (waiver: tests/large-document-guard-call-site.test.ts).
 * The latch's behaviour is specified in tests/on-first-success.test.ts; this file
 * pins that App wires it: the default-mode switch lives only inside the latch,
 * and the latch fires only on a successful open. Comments are stripped before
 * matching so prose cannot satisfy or defeat a check. Every slice fails loudly
 * when its anchor is missing rather than leaving an empty, vacuous slice.
 *
 * D125 moved the drop's open loop (`openDroppedMarkdown`) and `openPaths` out of
 * App.tsx into `src/hooks/useOpenPaths.ts`; those slices are taken there, and App's
 * `handleFileDrop` must hand its markdown paths over without switching itself. The
 * same callbacks are driven behaviourally in `tests/d95-app-open-activation.test.ts`.
 * D279 moved `handleFileOpenEvent` into `src/hooks/useFileOpenEvent.ts`, so its
 * slices are taken there; its latch is driven behaviourally in
 * `tests/useFileOpenEvent.test.ts` (HK-L11).
 *
 * Residual risk: a latch invoked from a dead branch, or an alias of
 * `setViewMode`, can evade text matching.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSrc(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  const file = path.resolve(path.dirname(testPath), "../src", relative);
  // A missing source file fails as an assertion, not as an ENOENT throw.
  expect(fs.existsSync(file), `src/${relative} exists`).toBe(true);
  return fs.readFileSync(file, "utf-8");
}
const readApp = (): string => readSrc("App.tsx");

/** Strip block and line comments (App.tsx has no `//` inside string literals in these regions). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const DEPENDENCY_ARRAY_END = /\]\s*,?\s*\)\s*;/;

/** `const <name> = useCallback(` through its dependency array. Throws if absent. */
function callbackSlice(src: string, name: string, file = "App.tsx"): string {
  const anchor = `const ${name} = useCallback(`;
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`${file}: '${anchor}' not found; the D51 slice cannot be taken`);
  if (src.indexOf(anchor, start + anchor.length) >= 0) {
    throw new Error(`${file}: '${anchor}' occurs more than once`);
  }
  const rest = src.slice(start);
  const end = rest.search(DEPENDENCY_ARRAY_END);
  if (end < 0) throw new Error(`${file}: no dependency array after '${anchor}'`);
  const slice = rest.slice(0, end);
  expect(slice.match(/useCallback\(/g) ?? [], name).toHaveLength(1);
  return slice;
}

/** `const checkLaunchPaths = async () => {` through the effect's `void checkLaunchPaths();` call. */
function launchSlice(src: string): string {
  const anchor = "const checkLaunchPaths = async () => {";
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`App.tsx: '${anchor}' not found`);
  const endAnchor = /\n\s*void checkLaunchPaths\(\);\s*\n\s*\},\s*\[/;
  const rest = src.slice(start);
  const end = rest.search(endAnchor);
  if (end < 0) throw new Error("App.tsx: end of the checkLaunchPaths effect not found");
  return rest.slice(0, end);
}

const app = () => stripComments(readApp());
const openPathsHook = () => stripComments(readSrc("hooks/useOpenPaths.ts"));
/** D279 moved `handleFileOpenEvent` (and its `file:open` listener) out of App.tsx into this hook. */
const fileOpenEventHook = () => stripComments(readSrc("hooks/useFileOpenEvent.ts"));
const count = (s: string, needle: string | RegExp): number =>
  typeof needle === "string" ? s.split(needle).length - 1 : (s.match(new RegExp(needle.source, "g")) ?? []).length;

/** `onFirstSuccess(() => setViewMode(defaultViewMode))` — the only allowed form of the switch. */
const LATCHED_SWITCH = /onFirstSuccess\(\s*\(\)\s*=>\s*setViewMode\(defaultViewMode\)\s*,?\s*\)/;

describe("D51 handleFileDrop — App hands the markdown paths to openDroppedMarkdown and never switches", () => {
  it("has no setViewMode call and opens through openDroppedMarkdown", () => {
    const s = callbackSlice(app(), "handleFileDrop");
    expect(s).not.toContain("setViewMode(");
    expect(s).not.toContain("onFirstSuccess(");
    expect(s).toMatch(/\bopenDroppedMarkdown\(\s*mdPaths\s*\)/);
  });
});

describe("D51 openDroppedMarkdown — the view mode switches only after a file opened", () => {
  it("has no setViewMode call outside the onFirstSuccess latch", () => {
    const s = callbackSlice(openPathsHook(), "openDroppedMarkdown");
    expect(count(s, LATCHED_SWITCH), "latched switch").toBe(1);
    expect(count(s, "setViewMode("), "every setViewMode( is the latched one").toBe(1);
  });

  it("nothing before the first handleOpenPath( can switch the view mode", () => {
    const s = callbackSlice(openPathsHook(), "openDroppedMarkdown");
    const firstOpen = s.indexOf("handleOpenPath(");
    expect(firstOpen, "handleOpenPath( in slice").toBeGreaterThan(-1);
    const beforeOpen = s.slice(0, firstOpen).replace(new RegExp(LATCHED_SWITCH.source, "g"), "");
    expect(beforeOpen).not.toContain("setViewMode(");
  });

  it("creates one latch before the loop and invokes it only in a branch on the opened doc", () => {
    const s = callbackSlice(openPathsHook(), "openDroppedMarkdown");
    const decl = s.match(/const\s+(\w+)\s*=\s*onFirstSuccess\(/);
    expect(decl, "const <latch> = onFirstSuccess(").not.toBeNull();
    const latch = decl![1];
    const loop = s.indexOf("for (const filePath of mdPaths)");
    expect(loop, "the md open loop").toBeGreaterThan(-1);
    expect(s.indexOf(decl![0]), "latch created once, before the loop").toBeLessThan(loop);
    expect(count(s, /onFirstSuccess\(/)).toBe(1);

    const invocations = count(s, new RegExp(`\\b${latch}\\(\\)`));
    expect(invocations, `${latch}() invocations`).toBe(1);
    const call = s.search(new RegExp(`\\b${latch}\\(\\)`));
    expect(call, `${latch}() after handleOpenPath(`).toBeGreaterThan(s.indexOf("handleOpenPath("));
    // D95: the branch is on the open having activated its document.
    expect(s).toMatch(new RegExp(`if\\s*\\(\\s*opened\\?\\.activated\\s*\\)\\s*\\{?\\s*${latch}\\(\\)`));
  });
});

// D279: these slices read hooks/useFileOpenEvent.ts, where the handler moved; the assertions are unchanged.
describe("D51 handleFileOpenEvent — the view mode switches only after a file opened", () => {
  it("has no setViewMode call outside the onFirstSuccess latch", () => {
    const s = callbackSlice(fileOpenEventHook(), "handleFileOpenEvent", "hooks/useFileOpenEvent.ts");
    expect(count(s, "setViewMode("), "every setViewMode( is latched").toBe(count(s, LATCHED_SWITCH));
    const beforeOpen = s.slice(0, Math.max(0, s.indexOf("openPaths("))).replace(new RegExp(LATCHED_SWITCH.source, "g"), "");
    expect(s.indexOf("openPaths("), "openPaths( in slice").toBeGreaterThan(-1);
    expect(beforeOpen).not.toContain("setViewMode(");
  });

  it("passes the latch to openPaths", () => {
    const s = callbackSlice(fileOpenEventHook(), "handleFileOpenEvent", "hooks/useFileOpenEvent.ts");
    const named = s.match(/const\s+(\w+)\s*=\s*onFirstSuccess\(\s*\(\)\s*=>\s*setViewMode\(defaultViewMode\)\s*\)/);
    const latchArg = named ? named[1] : LATCHED_SWITCH.source;
    expect(s).toMatch(new RegExp(`openPaths\\(\\s*paths\\s*,\\s*${latchArg}\\s*,?\\s*\\)`));
  });
});

describe("D51 openPaths — onOpened fires only after a successful open", () => {
  it("accepts an optional onOpened callback", () => {
    const s = callbackSlice(openPathsHook(), "openPaths");
    expect(s).toMatch(/async\s*\(\s*paths:\s*string\[\]\s*,\s*onOpened\?:\s*\(\)\s*=>\s*void\s*,?\s*\)/);
  });

  it("invokes onOpened once, inside the doc branch of the try, never in the catch", () => {
    const s = callbackSlice(openPathsHook(), "openPaths");
    expect(count(s, /onOpened\??\.?\(\)/), "onOpened invocations").toBe(1);
    const call = s.search(/onOpened\??\.?\(\)/);
    const catchAt = s.indexOf("catch");
    expect(catchAt, "catch in slice").toBeGreaterThan(-1);
    expect(call, "onOpened() before catch").toBeLessThan(catchAt);
    // D95: opens through openPathOutcome, and fires only for an activated open.
    expect(call, "onOpened() after openPathOutcome(").toBeGreaterThan(s.indexOf("openPathOutcome("));
    expect(s).toMatch(/if\s*\(\s*opened\?\.activated\s*\)\s*\{[^}]*onOpened\??\.?\(\)[^}]*\}/);
  });
});

describe("D51 cold launch — deliberately unchanged (no current document to protect)", () => {
  it("checkLaunchPaths still switches to the default view mode before opening", () => {
    const s = launchSlice(app());
    expect(s).toMatch(/setViewMode\(defaultViewMode\);\s*await openPaths\(paths\);/);
    expect(s).not.toContain("onFirstSuccess");
  });
});
