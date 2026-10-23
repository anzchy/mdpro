import { act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { SearchQuery, setSearchQuery } from "@codemirror/search";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";

afterEach(teardownEditor);

it("opens Source Replace with its input focused on Cmd+H", () => {
  const view = mountEditor("alpha alpha", { appliedShortcuts: defaultAppliedShortcuts() });
  const event = new KeyboardEvent("keydown", { key: "h", metaKey: true, bubbles: true, cancelable: true });
  act(() => { view.contentDOM.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")).toBe(document.activeElement);
});

it("keeps F3 navigation when the configurable Find Next key is unassigned", () => {
  const applied = defaultAppliedShortcuts();
  applied.bindings.editFindNext = { state: "unassigned" };
  const view = mountEditor("alpha alpha", { appliedShortcuts: applied });
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true })); });
  expect(view.dom.querySelector(".cm-search")).not.toBeNull();
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "alpha" })), selection: { anchor: 0, head: 5 } });
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "F3", bubbles: true, cancelable: true })); });
  expect(view.state.selection.main.from).toBe(6);
});

it.each([
  ["default", "editFindNext", "F3", false, 0, 6],
  ["custom", "editFindNext", "F3", false, 0, 6],
  ["unassigned", "editFindNext", "F3", false, 0, 6],
  ["default", "editFindPrevious", "F3", true, 6, 0],
  ["custom", "editFindPrevious", "F3", true, 6, 0],
  ["unassigned", "editFindPrevious", "F3", true, 6, 0],
] as const)("fixed %s navigation survives %s %s primary", (state, field, key, shift, from, expected) => {
  const applied = defaultAppliedShortcuts();
  if (state === "custom") applied.bindings[field] = { state: "bound", chord: "Cmd+Option+J" };
  if (state === "unassigned") applied.bindings[field] = { state: "unassigned" };
  const view = mountEditor("alpha alpha", { appliedShortcuts: applied });
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true })); });
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "alpha" })), selection: { anchor: from, head: from + 5 } });
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true })); });
  expect(view.state.selection.main.from).toBe(expected);
});

it("uses a custom Replace key and leaves the old Cmd+H inert", () => {
  const applied = defaultAppliedShortcuts();
  applied.bindings.editReplace = { state: "bound", chord: "Cmd+Option+H" };
  const view = mountEditor("alpha", { appliedShortcuts: applied });
  const press = (altKey: boolean) => {
    const event = new KeyboardEvent("keydown", { key: "h", metaKey: true, altKey, bubbles: true, cancelable: true });
    act(() => { view.contentDOM.dispatchEvent(event); });
    return event;
  };
  expect(press(false).defaultPrevented).toBe(false);
  expect(view.dom.querySelector(".cm-search")).toBeNull();
  expect(press(true).defaultPrevented).toBe(true);
  expect(view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")).toBe(document.activeElement);
});

it("uses the applied Select Word key and removes the old Cmd+D", () => {
  const applied = defaultAppliedShortcuts();
  applied.bindings.editSelectWord = { state: "bound", chord: "Cmd+Option+D" };
  const view = mountEditor("alpha beta", { appliedShortcuts: applied });
  view.dispatch({ selection: { anchor: 2 } });
  const press = (altKey: boolean) => {
    const event = new KeyboardEvent("keydown", { key: "d", code: "KeyD", keyCode: 68, metaKey: true, altKey, bubbles: true, cancelable: true });
    act(() => { view.contentDOM.dispatchEvent(event); });
    return event;
  };
  expect(press(false).defaultPrevented).toBe(false);
  expect(view.state.selection.main.empty).toBe(true);
  expect(press(true).defaultPrevented).toBe(true);
  expect(view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to)).toBe("alpha");
});
