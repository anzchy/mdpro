// @vitest-environment node
/**
 * D24 WI-2 — which App.tsx / Editor.tsx call sites carry the user intent
 * (ADR-0031 step 6). Matrix: `.claude/tdd-guardian/tests-20261007-171405.md`,
 * cases UEP-03 and UEP-03b. UEP-03c (the `useLastViewModePersistence({` call
 * site) belongs to WI-3 and is added by WI-3, not here: it is RED until App
 * stops passing `viewMode`/`setViewMode` to the persistence hook.
 *
 * ── SPEC LEVEL: EVERY CASE IN THIS FILE IS BELOW LEVEL 6 ─────────────────────
 *
 * Every assertion is SOURCE-TEXT INSPECTION. Nothing here renders App or
 * Editor, runs a handler, or observes the store. This file is a SUPPLEMENT:
 * the behaviour is discharged at the hook level by UEP-01/UEP-02
 * (`tests/view-mode-user-entry-points.test.tsx`) and on the device by M-1 to
 * M-3. No test in this repo renders App, so for App's handler objects source
 * text is the only automated signal (the same justification as
 * `tests/theme-hydration-call-site.test.ts`). The unit has NO LAW: it is
 * routing, with no conserved quantity, round trip or ordering.
 *
 * ── Residual risk these cases do NOT close ───────────────────────────────────
 *
 *   - A helper that wraps the adapter (`onCycleViewMode: cycleAsUser`) fails
 *     the user-site match even if it is correct, and a helper defined elsewhere
 *     that passes "user" through a variable satisfies the programmatic fences.
 *   - A user site that is never reached (dead branch) satisfies the match.
 *   - An alias import (`userViewModeCommands as uvc`) fails the match.
 *   - Extracting a handler object to a const, or renaming
 *     `userViewModeCommands`, is a wiring-only break these cases report.
 *
 * ── Slice anchors (confirmed against App.tsx / Editor.tsx, 2026-10-07) ───────
 *
 * Every region is SLICED before matching, and every `indexOf` is checked
 * against -1 before it is used, because App.tsx holds both user and
 * programmatic `setViewMode` references and a whole-file match is vacuous.
 *
 *   keyboard     `useKeyboardShortcuts({`        → next `});`
 *   menu         `useMenuEvents({`               → next `});`
 *   degrade arm  `buildLargeDocumentDegradeLog(` → `case "withhold-table-extensions"`
 *                (the bare name also occurs in the import line, so the anchor
 *                carries the paren)
 *   drop         `const handleFileDrop = useCallback(`
 *                → `[defaultViewMode, handleImageDrop, handleOpenPath, setViewMode],`
 *   launch paths `const checkLaunchPaths`
 *                → `[defaultViewMode, openPaths, preferencesLoaded, setViewMode]`
 *   Finder open  `const handleFileOpenEvent`
 *                → `[defaultViewMode, openPaths, setViewMode, shouldHandleWindowEvent]`
 *   Editor       `const viewModeKeymap`          → next `[],` (the useMemo deps)
 *
 * CORRECTIONS to the matrix's anchors (recorded, not quietly applied):
 *   - launch paths: the matrix ends the slice at the next `setLaunchPathsComplete(`.
 *     That is the retry-exhausted branch, which comes BEFORE
 *     `setViewMode(defaultViewMode)`, so the matrix's own non-vacuity anchor
 *     could never be inside the slice. The effect's deps array is used instead.
 *   - Finder open: the matrix ends at "its closing deps `]);`", but the deps
 *     are written `],\n  );`, so the first literal `]);` lies past the
 *     function. The deps array itself is used instead.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Anchor on expect.getState().testPath, NOT import.meta.url: under Vite's
// transform import.meta.url is not a file:// URL.
function readSrc(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("testPath unavailable");
  return fs.readFileSync(path.resolve(path.dirname(testPath), "../src", relative), "utf-8");
}

const readAppSrc = () => readSrc("App.tsx");

/** Slice [start, end) where end is the first `endAnchor` after `startAnchor`. */
function slice(src: string, startAnchor: string, endAnchor: string, label: string): string {
  const start = src.indexOf(startAnchor);
  expect(start, `${label}: "${startAnchor}" not found`).toBeGreaterThan(-1);
  const end = src.indexOf(endAnchor, start + startAnchor.length);
  expect(end, `${label}: "${endAnchor}" not found after "${startAnchor}"`).toBeGreaterThan(-1);
  return src.slice(start, end);
}

function expectSingle(src: string, anchor: string): void {
  const first = src.indexOf(anchor);
  expect(first, `"${anchor}" not found`).toBeGreaterThan(-1);
  expect(src.lastIndexOf(anchor), `"${anchor}" occurs more than once`).toBe(first);
}

const USER_ADAPTER = /userViewModeCommands/;
const USER_LITERAL = /["']user["']/;

describe("UEP-03 App.tsx and Editor.tsx call sites (source text, supplement)", () => {
  it("the keyboard handler object cycles through the user adapter", () => {
    const src = readAppSrc();
    expectSingle(src, "useKeyboardShortcuts({");
    const keyboard = slice(src, "useKeyboardShortcuts({", "});", "keyboard");
    expect(keyboard).toMatch(/onCycleViewMode:\s*userViewModeCommands\.cycle\b/);
    expect(keyboard).not.toMatch(/onCycleViewMode:\s*cycleViewMode\b/);
  });

  it("the menu handler object sets and cycles through the user adapter", () => {
    const src = readAppSrc();
    expectSingle(src, "useMenuEvents({");
    const menu = slice(src, "useMenuEvents({", "});", "menu");
    expect(menu).toMatch(/onViewModeChange:\s*userViewModeCommands\.set\b/);
    expect(menu).toMatch(/onCycleViewMode:\s*userViewModeCommands\.cycle\b/);
    expect(menu).not.toMatch(/onViewModeChange:\s*setViewMode\b/);
    expect(menu).not.toMatch(/onCycleViewMode:\s*cycleViewMode\b/);
  });

  it.each([
    {
      label: "degrade arm",
      start: "buildLargeDocumentDegradeLog(",
      end: 'case "withhold-table-extensions"',
      anchor: 'setViewMode("source")',
    },
    {
      label: "drop handler",
      start: "const handleFileDrop = useCallback(",
      end: "[defaultViewMode, handleImageDrop, handleOpenPath, setViewMode],",
      anchor: "setViewMode(defaultViewMode)",
    },
    {
      label: "launch paths",
      start: "const checkLaunchPaths",
      end: "[defaultViewMode, openPaths, preferencesLoaded, setViewMode]",
      anchor: "setViewMode(defaultViewMode)",
    },
    {
      label: "Finder open",
      start: "const handleFileOpenEvent",
      end: "[defaultViewMode, openPaths, setViewMode, shouldHandleWindowEvent]",
      anchor: "setViewMode(defaultViewMode)",
    },
  ])("the $label stays programmatic", ({ label, start, end, anchor }) => {
    const region = slice(readAppSrc(), start, end, label);
    // Non-vacuity: the programmatic call is inside the slice.
    expect(region).toContain(anchor);
    expect(region).not.toMatch(USER_ADAPTER);
    expect(region).not.toMatch(USER_LITERAL);
  });

  it("useOpenUrlParam.ts stays programmatic", () => {
    const hook = readSrc("hooks/useOpenUrlParam.ts");
    expect(hook).toContain("setViewMode(defaultViewMode)");
    expect(hook).not.toMatch(USER_ADAPTER);
    expect(hook).not.toMatch(USER_LITERAL);
  });

  it("the Editor.tsx Mod-/ binding cycles through the user adapter; Mod-Alt-/ is unchanged", () => {
    const keymapBlock = slice(readSrc("components/Editor/Editor.tsx"), "const viewModeKeymap", "[],", "Editor");
    const altIdx = keymapBlock.indexOf("Mod-Alt-/");
    expect(altIdx, '"Mod-Alt-/" not found in the viewModeKeymap block').toBeGreaterThan(-1);
    const modSlash = keymapBlock.slice(0, altIdx);
    expect(modSlash).toContain('"Mod-/"');
    expect(modSlash).toContain("userViewModeCommands.cycle(");
    expect(modSlash).not.toContain(".cycleViewMode()");
    expect(keymapBlock).toMatch(/\{\s*key:\s*"Mod-Alt-\/",\s*run:\s*toggleLineComment\s*\}/);
  });
});

describe("UEP-03b App passes the programmatic setViewMode into useOpenUrlParam (source text)", () => {
  it("the ?open= call site receives useEditor()'s store setter, never the user adapter", () => {
    const src = readAppSrc();
    expectSingle(src, "useOpenUrlParam({");
    const call = slice(src, "useOpenUrlParam({", "});", "useOpenUrlParam");
    expect(call).toMatch(/\bsetViewMode\s*(,|:\s*setViewMode\b)/);
    expect(call).not.toMatch(USER_ADAPTER);
    expect(call).not.toMatch(USER_LITERAL);

    // Provenance: App's only `setViewMode` binding is the useEditor() destructure.
    expect(src).toMatch(/const\s*\{[^}]*\bsetViewMode\b[^}]*\}\s*=\s*useEditor\(\)/);
    expect(src.match(/\bsetViewMode\s*=(?!=)/g) ?? []).toHaveLength(0);

    // And useEditor returns the store's own action, not the adapter.
    const useEditor = readSrc("hooks/useEditor.ts");
    expect(useEditor).toMatch(/\bsetViewMode\s*=\s*useEditorStore\(\s*\(\s*(\w+)\s*\)\s*=>\s*\1\.setViewMode\s*\)/);
    expect(useEditor).not.toMatch(USER_ADAPTER);
  });
});

/*
 * UEP-03c (D24 WI-3) — App feeds the persistence hook a REACTIVE
 * `userViewModeChoice`, and no longer passes `setViewMode`. Below Level 6,
 * a supplement like every case above. It fences (a) the old apply path left
 * in place and (b) a `getState()` snapshot, which would never re-render App on
 * a D-3 no-change command, so LVI-05/LVI-07 would pass in the harness (which
 * subscribes reactively) while failing in the product.
 *
 * Residual risk: a reactive selector of another shape (for example
 * `useEditorStore(useShallow(...))`, or a new `useViewModeChoice()` hook) fails
 * this case although it is reactive. Widen the regex deliberately in that
 * commit; never delete it.
 */
describe("UEP-03c App feeds the persistence hook a reactive userViewModeChoice (source text)", () => {
  it("passes the subscribed choice, not setViewMode and not a getState() snapshot", () => {
    const src = readAppSrc();
    expectSingle(src, "useLastViewModePersistence({");
    const call = slice(src, "useLastViewModePersistence({", "});", "useLastViewModePersistence");
    expect(call).toMatch(/\buserViewModeChoice\s*(,|:\s*userViewModeChoice\b)/);
    expect(call).not.toMatch(/\bsetViewMode\b/);

    const useEditorSrc = readSrc("hooks/useEditor.ts");
    expect(src).not.toMatch(/getState\(\)\.userViewModeChoice/);
    expect(useEditorSrc).not.toMatch(/getState\(\)\.userViewModeChoice/);

    const selector =
      /const\s+userViewModeChoice\s*=\s*useEditorStore\(\s*\(\s*(\w+)\s*\)\s*=>\s*\1\.userViewModeChoice\s*\)/;
    const shapeA = selector.test(src);
    const returnStart = useEditorSrc.lastIndexOf("return {");
    const returned =
      returnStart > -1 ? useEditorSrc.slice(returnStart, useEditorSrc.indexOf("}", returnStart)) : "";
    const shapeB =
      /const\s*\{[^}]*\buserViewModeChoice\b[^}]*\}\s*=\s*useEditor\(\)/.test(src) &&
      selector.test(useEditorSrc) &&
      returned.includes("userViewModeChoice");
    expect(
      shapeA || shapeB,
      "expected (A) a `useEditorStore((s) => s.userViewModeChoice)` selector in App, or " +
        "(B) `userViewModeChoice` from the useEditor() destructure, selected and returned by useEditor.ts",
    ).toBe(true);
  });
});
