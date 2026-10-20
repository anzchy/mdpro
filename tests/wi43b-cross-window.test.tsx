import { afterEach, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSettings } from "../src/components/common/settings/EditorSettings";
import { preferencesService } from "../src/services/preferencesService";
import { installBoundary, LOADED } from "./support/settingsRowSites";
import type { EditorConfig } from "../src/types/preferences";
import { DEFAULT_EDITOR_CONFIG } from "../src/types/preferences";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("a queued Editor line-height patch preserves a newer font size saved in another window", async () => {
  vi.resetModules();
  const windowA = await import("../src/components/common/settings/settingsWriterRegistry");
  vi.resetModules();
  const windowB = await import("../src/components/common/settings/settingsWriterRegistry");
  const service = await import("../src/services/preferencesService");
  const supportsLeafPatch = "patchPreferences" in service.preferencesService;
  let persisted: EditorConfig = { ...DEFAULT_EDITOR_CONFIG };
  const requests: Partial<EditorConfig>[] = [];
  let releaseFirst!: () => void;
  let first = true;
  const save = async (next: EditorConfig, patch: Partial<EditorConfig>) => {
    requests.push(patch);
    if (first) {
      first = false;
      persisted = supportsLeafPatch ? { ...persisted, ...patch } : { ...next };
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
    } else {
      persisted = supportsLeafPatch ? { ...persisted, ...patch } : { ...next };
    }
    return { ...persisted };
  };
  windowA.mount("editor", { save, apply: () => {}, onConfirm: () => {} });
  windowB.mount("editor", { save, apply: () => {}, onConfirm: () => {} });
  windowA.load("editor", { ...persisted });
  windowB.load("editor", { ...persisted });
  const a1 = windowA.write<EditorConfig>("editor", { fontFamily: "serif" });
  const a2 = windowA.write<EditorConfig>("editor", { lineHeightX10: 18 });
  await Promise.resolve();
  windowA.unmount("editor");
  const b = windowB.write<EditorConfig>("editor", { fontSize: 20 });
  await b;
  releaseFirst();
  await Promise.all([a1, a2]);
  expect(requests[2]).toEqual({ lineHeightX10: 18 });
  expect(persisted.fontFamily).toBe("serif");
  expect(persisted.lineHeightX10).toBe(18);
  expect(persisted.fontSize).toBe(20);
});

it("the Editor page sends only the edited leaf to the patch wrapper", async () => {
  installBoundary();
  const patch = vi.spyOn(preferencesService, "patchPreferences").mockResolvedValue(LOADED.editor);
  const user = userEvent.setup();
  render(<EditorSettings />);
  await user.selectOptions(await screen.findByRole("combobox", { name: "Font Family" }), "serif");
  expect(patch).toHaveBeenCalledWith("editor", { fontFamily: "serif" }, expect.objectContaining({ fontFamily: "serif" }));
});

it("a returned sibling value refreshes an older local claim", async () => {
  vi.resetModules();
  const registry = await import("../src/components/common/settings/settingsWriterRegistry");
  const apply = vi.fn();
  let saves = 0;
  registry.mount("editor", {
    save: async (next: EditorConfig) => {
      saves += 1;
      return { ...next, fontSize: saves === 1 ? 18 : 20 };
    },
    apply,
    onConfirm: () => {},
  });
  registry.load("editor", { ...DEFAULT_EDITOR_CONFIG });
  await registry.write<EditorConfig>("editor", { fontSize: 18 });
  await registry.write<EditorConfig>("editor", { lineHeightX10: 18 });
  expect(registry.shownValue<EditorConfig>("editor")?.fontSize).toBe(20);
  expect(apply).toHaveBeenCalledWith("fontSize", 20);
});
