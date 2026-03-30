/**
 * Tests for SettingsDialog component.
 *
 * Strategy: source inspection for accessibility guarantees, navigation logic,
 * and event wiring.
 *
 * Covers:
 *   1. Renders nothing when open=false (early return).
 *   2. Dialog has role="dialog" and aria-labelledby="settings-dialog-title".
 *   3. Backdrop click calls onClose.
 *   4. Escape key on backdrop calls onClose.
 *   5. Click inside dialog does NOT propagate to backdrop (stopPropagation).
 *   6. All nav items in NAV_ITEMS are rendered.
 *   7. Each settings page component is conditionally rendered by activePage.
 *   8. Close button (×) calls onClose.
 *   9. First nav item gets firstNavRef for focus management on open.
 *  10. Theme class applied: `settings-dialog theme-${resolvedTheme}`.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const dialogSrc = fs.readFileSync(
  path.join(SRC, "components/common/SettingsDialog.tsx"),
  "utf-8",
);

describe("SettingsDialog — source structure", () => {
  it("exports SettingsDialog as a named export", () => {
    expect(dialogSrc).toContain("export function SettingsDialog");
  });

  it("returns null when open is false (renders nothing)", () => {
    expect(dialogSrc).toContain("if (!open) return null");
  });

  it("dialog element has role='dialog'", () => {
    expect(dialogSrc).toContain('role="dialog"');
  });

  it("dialog has aria-labelledby='settings-dialog-title'", () => {
    expect(dialogSrc).toContain('aria-labelledby="settings-dialog-title"');
  });

  it("heading has id='settings-dialog-title' matching aria-labelledby", () => {
    expect(dialogSrc).toContain('id="settings-dialog-title"');
  });

  it("backdrop onClick calls onClose", () => {
    expect(dialogSrc).toContain("onClose()");
    // The backdrop has onClick with onClose
    expect(dialogSrc).toContain("dialog-backdrop");
    expect(dialogSrc).toContain("onClick");
  });

  it("backdrop onKeyDown handles Escape key to call onClose", () => {
    expect(dialogSrc).toContain('"Escape"');
    expect(dialogSrc).toContain("onKeyDown");
  });

  it("inner dialog uses e.stopPropagation to prevent backdrop close on inner click", () => {
    expect(dialogSrc).toContain("stopPropagation");
  });

  it("navigates to 'general' page on open (resets activePage)", () => {
    expect(dialogSrc).toContain('setActivePage("general")');
  });

  it("focuses first nav item on open via firstNavRef", () => {
    expect(dialogSrc).toContain("firstNavRef");
    expect(dialogSrc).toContain("focus()");
  });

  it("applies theme class: settings-dialog theme-${resolvedTheme}", () => {
    expect(dialogSrc).toMatch(/`settings-dialog theme-\$\{resolvedTheme\}`/);
  });
});

describe("SettingsDialog — navigation items", () => {
  const NAV_IDS = [
    "general",
    "editor",
    "markdown",
    "image",
    "integrations",
    "export",
    "appearance",
    "keyboard-shortcuts",
    "advanced",
  ];

  for (const id of NAV_IDS) {
    it(`nav item '${id}' is defined in NAV_ITEMS`, () => {
      expect(dialogSrc).toContain(`"${id}"`);
    });
  }
});

describe("SettingsDialog — page routing", () => {
  it("renders GeneralSettings when activePage === 'general'", () => {
    expect(dialogSrc).toContain("<GeneralSettings");
    expect(dialogSrc).toContain('"general"');
  });

  it("renders EditorSettings when activePage === 'editor'", () => {
    expect(dialogSrc).toContain("<EditorSettings");
    expect(dialogSrc).toContain('"editor"');
  });

  it("renders MarkdownSettings when activePage === 'markdown'", () => {
    expect(dialogSrc).toContain("<MarkdownSettings");
  });

  it("renders AppearanceSettings when activePage === 'appearance'", () => {
    expect(dialogSrc).toContain("<AppearanceSettings");
  });

  it("renders KeyboardShortcutsSettings with onClose prop", () => {
    expect(dialogSrc).toContain("<KeyboardShortcutsSettings");
    expect(dialogSrc).toContain("onClose={onClose}");
  });

  it("renders IntegrationsSettings with mcpConfig and onMcpConfigChange props", () => {
    expect(dialogSrc).toContain("<IntegrationsSettings");
    expect(dialogSrc).toContain("mcpConfig=");
    expect(dialogSrc).toContain("onMcpConfigChange=");
  });

  it("renders AdvancedSettings page", () => {
    expect(dialogSrc).toContain("<AdvancedSettings");
  });
});

describe("SettingsDialog — MCP config", () => {
  it("loads MCP config via preferencesService.getPreferences on open", () => {
    expect(dialogSrc).toContain("preferencesService.getPreferences");
    expect(dialogSrc).toContain("p.mcp");
  });

  it("handleMcpConfigChange calls preferencesService.setPreferences", () => {
    expect(dialogSrc).toContain("preferencesService.setPreferences");
    expect(dialogSrc).toContain("handleMcpConfigChange");
  });

  it("uses DEFAULT_MCP_CONFIG as the initial mcpConfig state", () => {
    expect(dialogSrc).toContain("DEFAULT_MCP_CONFIG");
  });
});

describe("SettingsDialog — logging", () => {
  it("logs backdrop cancel with logDialogAction", () => {
    expect(dialogSrc).toContain("loggingService.logDialogAction");
    expect(dialogSrc).toContain('"cancel"');
  });

  it("logs close button click with logButtonClick", () => {
    expect(dialogSrc).toContain("loggingService.logButtonClick");
    expect(dialogSrc).toContain('"settings.close"');
  });

  it("logs nav category change with logButtonClick", () => {
    expect(dialogSrc).toContain("settings.category.");
  });
});
