/**
 * @module export-pdf-menu-wiring.test
 * Purpose: Verify the File -> Export PDF menu action (WI-2.1 / plan T9) is wired
 * end-to-end at the integration seam, and that the new View -> Show Status Bar
 * action (WI-2.3) is likewise wired. The Rust menu emits these actions and
 * useMenuEvents.ts has the cases, but the High review finding was that App.tsx
 * never supplied an `onExportPdf` callback — so File -> Export PDF was a silent
 * no-op (the `?.` optional-chaining swallowed the missing handler).
 *
 * Strategy: source inspection (mirrors tests/insert-table-shortcut-wiring.test.ts
 * and tests/use-menu-events-view-mode.test.ts). @testing-library/react is not a
 * dependency in this repo, so hook/integration wiring is asserted via static
 * analysis of the hook + App.tsx, which is what catches the App-level gap a
 * hook-only renderHook test would miss. This is the rule-60 Critical-Pass check:
 * "new menu:action values have a corresponding handler."
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const menuEventsSrc = fs.readFileSync(
  path.join(ROOT, "src/hooks/useMenuEvents.ts"),
  "utf-8",
);
const appSrc = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf-8");

// Extract a single case block from the switch so we can assert the body, not
// just the presence of the case label somewhere in the file.
function caseBlock(src: string, action: string): string | undefined {
  const re = new RegExp(
    `case\\s+["']${action.replace(".", "\\.")}["']\\s*:[\\s\\S]*?(?=\\n\\s+case|\\n\\s+default)`,
  );
  return src.match(re)?.[0];
}

describe("File -> Export PDF menu action is wired end-to-end", () => {
  it("useMenuEvents declares an onExportPdf handler in its MenuHandlers contract", () => {
    expect(menuEventsSrc).toMatch(/onExportPdf\?:/);
  });

  it('useMenuEvents has a "file.export_pdf" case that dispatches onExportPdf', () => {
    const block = caseBlock(menuEventsSrc, "file.export_pdf");
    expect(block).toBeDefined();
    expect(block).toMatch(/onExportPdf\?\./);
  });

  it("App.tsx passes an onExportPdf callback into useMenuEvents (the High-finding fix)", () => {
    // Scope the assertion to the useMenuEvents({...}) call so a stray mention
    // elsewhere can't satisfy it.
    const callBlock = appSrc.match(/useMenuEvents\(\{[\s\S]*?\}\);/)?.[0];
    expect(callBlock).toBeDefined();
    expect(callBlock).toMatch(/onExportPdf:/);
  });

  it("App.tsx's onExportPdf callback routes to exportService.exportPdf", () => {
    // The handler bridges the menu action to the typed IPC wrapper. Assert the
    // exportPdf call site exists (it had zero call sites before the fix).
    expect(appSrc).toMatch(/exportService\.exportPdf/);
  });

  it("useMenuEvents lists handlers.onExportPdf in its effect deps (no stale closure)", () => {
    // The listen() handler closes over onExportPdf; omitting it from the
    // useEffect deps array re-subscribes only on OTHER deps, capturing a stale
    // callback that could export a stale document (rule 60 stale-closure guard).
    // Scope to the `}, [ ... ]);` dependency array of the hook's useEffect.
    const depsArray = menuEventsSrc.match(/\},\s*\[([\s\S]*?)\]\s*\)\s*;/)?.[1];
    expect(depsArray).toBeDefined();
    expect(depsArray).toMatch(/handlers\.onExportPdf/);
  });
});

describe("View -> Show Status Bar menu action is wired end-to-end", () => {
  it("useMenuEvents declares an onToggleStatusBar handler in its contract", () => {
    expect(menuEventsSrc).toMatch(/onToggleStatusBar\?:/);
  });

  it('useMenuEvents has a "view.toggle_status_bar" case that dispatches onToggleStatusBar', () => {
    const block = caseBlock(menuEventsSrc, "view.toggle_status_bar");
    expect(block).toBeDefined();
    expect(block).toMatch(/onToggleStatusBar\?\./);
  });

  it("App.tsx passes an onToggleStatusBar callback into useMenuEvents", () => {
    const callBlock = appSrc.match(/useMenuEvents\(\{[\s\S]*?\}\);/)?.[0];
    expect(callBlock).toBeDefined();
    expect(callBlock).toMatch(/onToggleStatusBar:/);
  });
});
