/**
 * Tests for editorStore view mode behaviour after two-mode-editor refactor (WI-1).
 *
 * ViewMode is now "wysiwyg" | "source" (was 4 values).
 * cycleViewMode must only cycle between those 2 values.
 * setViewMode must accept both valid values.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useEditorStore } from "../src/stores/editorStore";
import { migrateViewMode } from "../src/utils/viewModeUtils";

beforeEach(() => {
  useEditorStore.setState({ viewMode: "wysiwyg" });
});

describe("editorStore — two-mode cycleViewMode", () => {
  it("cycles from wysiwyg to source", () => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    useEditorStore.getState().cycleViewMode();
    expect(useEditorStore.getState().viewMode).toBe("source");
  });

  it("cycles from source back to wysiwyg", () => {
    useEditorStore.setState({ viewMode: "source" });
    useEditorStore.getState().cycleViewMode();
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
  });

  it("cycles through exactly 2 modes (wysiwyg → source → wysiwyg)", () => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    useEditorStore.getState().cycleViewMode();
    useEditorStore.getState().cycleViewMode();
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
  });
});

describe("editorStore — setViewMode accepts valid modes", () => {
  it("sets viewMode to wysiwyg", () => {
    useEditorStore.getState().setViewMode("wysiwyg");
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
  });

  it("sets viewMode to source", () => {
    useEditorStore.getState().setViewMode("source");
    expect(useEditorStore.getState().viewMode).toBe("source");
  });

  it("idempotent: setViewMode to same value leaves mode unchanged", () => {
    useEditorStore.setState({ viewMode: "wysiwyg" });
    useEditorStore.getState().setViewMode("wysiwyg");
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");
  });
});

describe("migrateViewMode — legacy value handling", () => {
  it("maps 'editor-only' to 'source'", () => {
    expect(migrateViewMode("editor-only")).toBe("source");
  });

  it("maps 'split' to 'wysiwyg'", () => {
    expect(migrateViewMode("split")).toBe("wysiwyg");
  });

  it("maps 'preview-only' to 'wysiwyg'", () => {
    expect(migrateViewMode("preview-only")).toBe("wysiwyg");
  });

  it("maps null to 'wysiwyg'", () => {
    expect(migrateViewMode(null)).toBe("wysiwyg");
  });

  it("maps undefined to 'wysiwyg'", () => {
    expect(migrateViewMode(undefined)).toBe("wysiwyg");
  });

  it("preserves 'wysiwyg'", () => {
    expect(migrateViewMode("wysiwyg")).toBe("wysiwyg");
  });

  it("preserves 'source'", () => {
    expect(migrateViewMode("source")).toBe("source");
  });
});
