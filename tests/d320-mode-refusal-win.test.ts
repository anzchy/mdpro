import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
});
vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (await import("./support/menuEventsHarness")).invokeCapturingLogs,
}));

import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { useEditorStore } from "../src/stores/editorStore";
import { useToastStore } from "../src/stores/toastStore";
import { logs } from "./support/menuEventsHarness";
import { resetMenuHarness } from "./support/menuEventsDomain";
import { seedStores } from "./support/editorGenerationDomain";
import { mountMilkdownMenuRig, type MilkdownMenuRig } from "./support/editorMenuRig";

let rig: MilkdownMenuRig | null = null;

beforeEach(() => {
  resetMenuHarness();
  seedStores();
  useToastStore.getState().clearToast();
  useEditorStore.setState({ viewMode: "wysiwyg" });
});

afterEach(async () => {
  await rig?.destroy();
  rig = null;
  useToastStore.getState().clearToast();
});

it.each([
  ["Cmd+Option+Shift+M", "M"],
  ["Cmd+Option+Shift+J", "J"],
] as const)("D320 Windows %s refuses once with unchanged document", async (chord, key) => {
  const applied = defaultAppliedShortcuts("windows");
  applied.bindings.paragraphMathBlock = { state: "bound", chord };
  rig = await mountMilkdownMenuRig("alpha", applied);
  const before = rig.view.state.doc.toJSON();
  let toastCount = 0;
  const unsubscribe = useToastStore.subscribe((state) => {
    if (state.message) toastCount += 1;
  });
  if (key === "J") {
    const old = new KeyboardEvent("keydown", { key: "M", ctrlKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true });
    rig.view.dom.dispatchEvent(old);
    expect(old.defaultPrevented).toBe(false);
    expect(rig.view.state.doc.toJSON()).toEqual(before);
  }
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true });
  rig.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(rig.view.state.doc.toJSON()).toEqual(before);
  expect(toastCount).toBe(1);
  expect(useToastStore.getState().message).toBe("Available in Source mode only");
  const outcomes = logs.filter((line) => line.payload.event === "ui.menu.select");
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0].payload).toMatchObject({ status: "cancel", context: {
    controlId: "editor.paragraph.mathBlock", reason: "wrong_mode",
  } });
  unsubscribe();
});
