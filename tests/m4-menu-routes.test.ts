/** Purpose: every new macOS editor menu row reaches one frontend outcome. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { COMMAND_TABLE } from "../src/commands/commandTable";
import { dispatchEditorMenuAction } from "../src/hooks/editorMenuActionTable";
import { useEditorStore } from "../src/stores/editorStore";
import { logs } from "./support/menuEventsHarness";
import { resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";

beforeEach(() => {
  resetMenuHarness();
  seedStores();
  useEditorStore.setState({ viewMode: "source", editorView: null });
});

describe("M4 generated editor menu aliases", () => {
  it("emits one enum-only outcome for every new macOS table id", () => {
    const rows = COMMAND_TABLE.filter((row) =>
      row.menu.macos !== "none"
      && /^(edit|paragraph|format)\./.test(row.id)
      && row.id !== "paragraph.table" && row.id !== "format.highlight",
    );
    expect(rows.length).toBeGreaterThan(25);
    for (const row of rows) {
      logs.length = 0;
      expect(dispatchEditorMenuAction(`editor.${row.id}`)).toBe(true);
      const outcomes = logs.filter((entry) => entry.payload.event === "ui.menu.select");
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].payload.context?.controlId).toBe(`editor.${row.id}`);
      expect(outcomes[0].payload.status).toBe("cancel");
      expect(JSON.stringify(outcomes[0].payload)).not.toContain("/private/");
    }
  });

  it("keeps unknown and double-prefixed aliases silent", () => {
    expect(dispatchEditorMenuAction("editor.editor.paragraph.heading1")).toBe(false);
    expect(dispatchEditorMenuAction("editor.unknown")).toBe(false);
    expect(logs.filter((entry) => entry.payload.event === "ui.menu.select")).toEqual([]);
  });
});
