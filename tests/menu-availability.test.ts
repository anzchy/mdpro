/** M3b: v1 command-table availability and route are click-time gates. */
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { COMMAND_TABLE, rowById } from "../src/commands/commandTable";
import { useEditorStore } from "../src/stores/editorStore";
import { bus, logs } from "./support/menuEventsHarness";
import { flush, mountHook, resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";

beforeEach(() => {
  resetMenuHarness();
  seedStores();
  useEditorStore.setState({ viewMode: "wysiwyg" });
});

const cancellations = () => logs.filter(({ payload }) =>
  payload.event === "ui.menu.select" && payload.status === "cancel");

it("AC-4: v1 quote and lists refuse despite their v2 W capability", async () => {
  const hook = mountHook({});
  await flush();
  for (const id of ["paragraph.quote", "paragraph.orderedList", "paragraph.unorderedList"] as const) {
    const row = rowById(id)!;
    expect(row.availability.macos.v1).toBe("none");
    expect(row.availability.macos.v2).toBe("W");
    bus.emitTo("main", "menu:action", { action: `editor.${id}`, target: "main" });
    await flush();
  }
  expect(cancellations()).toHaveLength(3);
  hook.unmount();
});

it("AC-4: every table row has one exact id; malformed aliases never dispatch", async () => {
  const ids = COMMAND_TABLE.map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
  const hook = mountHook({});
  await flush();
  bus.emitTo("main", "menu:action", { action: "editor.editor.paragraph.heading2", target: "main" });
  bus.emitTo("main", "menu:action", { action: "editor.notACommand", target: "main" });
  await flush();
  expect(logs.filter(({ payload }) => payload.event === "ui.menu.select" && payload.status === "success")).toHaveLength(0);
  hook.unmount();
});

it("AC-4/7: wrong mode, native route and missing editor each refuse once", async () => {
  const hook = mountHook({});
  await flush();
  useEditorStore.setState({ viewMode: "source" });
  bus.emitTo("main", "menu:action", { action: "editor.format.strong", target: "main" });
  await flush();
  expect(cancellations().at(-1)?.payload.context?.reason).toBe("wrong_mode");

  bus.emitTo("main", "menu:action", { action: "editor.edit.undo", target: "main" });
  await flush();
  expect(cancellations().at(-1)?.payload.context?.reason).toBe("non_frontend");

  useEditorStore.setState({ viewMode: "wysiwyg" });
  bus.emitTo("main", "menu:action", { action: "editor.format.strong", target: "main" });
  await flush();
  expect(cancellations().at(-1)?.payload.context?.reason).toBe("missing_view");
  expect(cancellations()).toHaveLength(3);
  hook.unmount();
});

it("AC-7: a blocked click logs one enum-only refusal, never its payload value", async () => {
  const hook = mountHook({});
  await flush();
  const modal = document.body.appendChild(document.createElement("div"));
  modal.setAttribute("aria-modal", "true");
  bus.emitTo("main", "menu:action", {
    action: "editor.format.hyperlink", value: "SECRET /private/file.md", target: "main",
  });
  await flush();
  expect(cancellations()).toHaveLength(1);
  expect(cancellations()[0].payload.context?.reason).toBe("modal_open");
  expect(JSON.stringify(cancellations())).not.toContain("SECRET");
  expect(JSON.stringify(cancellations())).not.toContain("/private");
  modal.remove();
  hook.unmount();
});
