// @vitest-environment node
/**
 * @module radius-roles.test
 * Purpose: the DR23 radius snap of plan P WI-3.1. Each chrome radius that
 * Stage 2 deferred takes its role token: `--radius-control` for buttons,
 * inputs and flat rows, `--radius-popover` for menus, dialogs, toasts and
 * grouped sections, `--radius-inner` for parts nested inside those, and
 * `999px` for pills (the switch track, the About progress bar). The
 * tokenization guard proves no literal is left; this file proves each site
 * took the right role (delegator rulings 2026-10-15 for the MCP rows and the
 * mode label; user, STOP 2 Q1, for the link definition).
 *
 * Strategy: source inspection, one row per declaration.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";

const SRC = join(__dirname, "..", "src");
const S = "styles/sections/";
const CONTROL = "var(--radius-control)";
const POPOVER = "var(--radius-popover)";
const INNER = "var(--radius-inner)";
const PILL = "999px";

const ROLES: Array<[file: string, selector: string, value: string]> = [
  [S + "buttons-dialog.css", ".toolbar-button", CONTROL],
  [S + "settings-shell.css", ".settings-category-btn", CONTROL],
  [S + "toc-sidebar.css", ".settings-input", CONTROL],
  [S + "link-insert-modal.css", ".link-insert-input", CONTROL],
  [S + "settings-pages.css", ".settings-dirty-banner button", CONTROL],
  [S + "settings-mcp.css", ".mcp-client-row", CONTROL],
  // No rounded container: `.sidebar-traffic-area` and `.main-traffic-area` have no radius (DESIGN.md:139).
  [S + "app-shell.css", ".sidebar-mode-label", CONTROL],
  ["components/Editor/ImageContextMenu.css", ".image-context-menu", POPOVER],
  [S + "table-context-menu.css", ".table-context-menu", POPOVER],
  [S + "buttons-dialog.css", ".dialog-card", POPOVER],
  [S + "settings-shell.css", ".settings-dialog", POPOVER],
  [S + "recovery-toast.css", ".toast", POPOVER],
  [S + "recovery-toast.css", ".recovery-item", POPOVER],
  [S + "settings-shell.css", ".shortcuts-section", POPOVER],
  [S + "settings-mcp.css", ".mcp-server-info", POPOVER],
  ["components/Editor/ImageContextMenu.css", ".image-context-menu-button", INNER],
  [S + "table-context-menu.css", ".table-context-menu-item", INNER],
  [S + "settings-rows.css", ".settings-stepper button", INNER],
  ["plugins/milkdown/inlineEditPlugin.css", ".milkdown-editor .ProseMirror .milkdown-link-expanded", INNER],
  [S + "table-insert-modal.css", ".grid-picker-cell", INNER],
  [S + "editor-source.css", ".editor-shell .cm-table-active-cell", INNER],
  ["plugins/milkdown/linkDefinitions/linkDefinitions.css", ".milkdown-editor .ProseMirror .mdpro-link-definition", INNER],
  [S + "settings-rows.css", ".toggle-slider", PILL],
  [S + "settings-about.css", ".about-progress-bar", PILL],
  [S + "settings-about.css", ".about-progress-bar::-webkit-progress-bar", PILL],
  [S + "settings-about.css", ".about-progress-bar::-webkit-progress-value", PILL],
];

describe("DR23 radius roles (WI-3.1)", () => {
  for (const [file, selector, value] of ROLES) {
    it(`${selector} → ${value}`, () => {
      const radii = parseDeclarations(readFileSync(join(SRC, file), "utf8"))
        .filter((d) => d.selector === selector && d.property === "border-radius")
        .map((d) => d.value);
      expect(radii).toEqual([value]);
    });
  }
});
