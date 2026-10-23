import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";

afterEach(teardownEditor);

it("AltGr printable input does not trigger an applied Ctrl+Alt heading command", () => {
  const view = mountEditor("alpha", { appliedShortcuts: defaultAppliedShortcuts("linux") });
  const event = new KeyboardEvent("keydown", {
    key: "[", code: "BracketLeft", keyCode: 219, ctrlKey: true, altKey: true,
    bubbles: true, cancelable: true,
  });
  Object.defineProperty(event, "getModifierState", { value: (name: string) => name === "AltGraph" });
  view.contentDOM.dispatchEvent(event);
  expect(view.state.doc.toString()).toBe("alpha");
  expect(event.defaultPrevented).toBe(false);
});

it("a genuine Ctrl+Alt heading chord still reaches Source", () => {
  const view = mountEditor("alpha", { appliedShortcuts: defaultAppliedShortcuts("linux") });
  const event = new KeyboardEvent("keydown", {
    key: "]", code: "BracketRight", keyCode: 221, ctrlKey: true, altKey: true,
    bubbles: true, cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe("###### alpha");
});

it.each([
  ["[", "KeyF"], ["]", "KeyG"], ["\\", "KeyS"], ["{", "BracketLeft"], ["@", "KeyQ"],
])("a printable AltGr %s with a differing base key is not consumed", (key, code) => {
  const view = mountEditor("alpha", { appliedShortcuts: defaultAppliedShortcuts("linux") });
  const event = new KeyboardEvent("keydown", {
    key, code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(view.state.doc.toString()).toBe("alpha");
});
