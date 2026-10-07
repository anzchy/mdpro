// @vitest-environment node
/**
 * @module wide-table-fit-to-width.test
 * Purpose: Verify the WYSIWYG wide-table fit-to-width CSS lands
 * (Phase 2 WI-2.7). Strategy: source inspection — mirrors
 * `tests/design-tokens-accent-danger.test.ts`. Visual verification is
 * a manual step (`pnpm dev` with a wide-column fixture).
 *
 * The rules style the .tableWrapper that prosemirror-tables's
 * columnResizing plugin already renders around every table. No
 * additional ProseMirror nodeView is needed.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const milkdownCss = fs.readFileSync(
  path.join(ROOT, "src/components/Editor/MilkdownEditor.css"),
  "utf-8",
);

describe("WI-2.7 — wide-table scroll container CSS", () => {
  it("makes .tableWrapper a horizontal scroll container", () => {
    const block = milkdownCss.match(
      /\.tableWrapper\s*\{[^}]*\}/m,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/overflow-x:\s*auto/);
    expect(block![0]).toMatch(/max-width:\s*100%/);
  });

  it("drops the bottom margin on tables that sit inside the wrapper to avoid double-spacing", () => {
    expect(milkdownCss).toMatch(
      /\.tableWrapper\s*>\s*table\s*\{[^}]*margin:\s*0[^}]*\}/m,
    );
  });

  // Audit-fix M12: the inner table sizes by content with a 100%
  // minimum so wide tables overflow into the wrapper's scroll
  // container deterministically, not just after column-resize sets
  // an inline min-width.
  it("inner table uses width: max-content with min-width: 100% (canonical rule-32 pattern)", () => {
    const block = milkdownCss.match(
      /\.tableWrapper\s*>\s*table\s*\{[^}]*\}/m,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/width:\s*max-content/);
    expect(block![0]).toMatch(/min-width:\s*100%/);
  });
});
