import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { runScopeHandlers } from "@codemirror/view";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";

afterEach(teardownEditor);

it("uses a custom Source Bold chord and leaves its old and unassigned chord inert", () => {
  const applied = defaultAppliedShortcuts("macos");
  applied.bindings.formatStrong = { state: "bound", chord: "Cmd+J" };
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  view.dispatch({ selection: { anchor: 0, head: 5 } });
  runScopeHandlers(view, new KeyboardEvent("keydown", { key: "b", metaKey: true }), "editor");
  expect(view.state.doc.toString()).toBe("alpha");
  runScopeHandlers(view, new KeyboardEvent("keydown", { key: "j", metaKey: true }), "editor");
  expect(view.state.doc.toString()).toBe("**alpha**");
  teardownEditor();
  const unassigned = defaultAppliedShortcuts("macos");
  unassigned.bindings.formatStrong = { state: "unassigned" };
  const next = mountEditor("alpha", { appliedShortcuts: unassigned });
  next.dispatch({ selection: { anchor: 0, head: 5 } });
  runScopeHandlers(next, new KeyboardEvent("keydown", { key: "b", metaKey: true }), "editor");
  expect(next.state.doc.toString()).toBe("alpha");
});

