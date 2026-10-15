/**
 * D230-WI-3 (audit b156 M, IME family with D219): Enter in the Insert Link URL
 * field submitted while an input method was still composing, so the Enter
 * that commits a candidate (e.g. pinyin) inserted a half-typed URL. Enter now
 * submits only when no composition is in progress: `isComposing`, or WebKit's
 * keyCode 229 for a keydown that belongs to the IME.
 *
 * userEvent cannot drive an IME, so the keydowns are dispatched with
 * `fireEvent` on the real URL field, carrying the flags WebKit sets.
 * Mocked only at the Tauri boundary; the real store and modal run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { LinkInsertModal } from "../src/components/Editor/LinkInsertModal";

let inserted: string[];

function renderWithUrl(value: string) {
  render(<LinkInsertModal />);
  act(() => useLinkInsertStore.getState().setPendingCallback((url: string) => inserted.push(url), "wysiwyg"));
  const url = screen.getByRole("textbox", { name: "URL" });
  act(() => url.focus());
  fireEvent.change(url, { target: { value } });
  return url;
}

beforeEach(() => {
  inserted = [];
  useLinkInsertStore.setState({ pendingCallback: null, mode: "wysiwyg" });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  act(() => useLinkInsertStore.getState().clearPendingCallback());
  vi.unstubAllGlobals();
});

describe("D230-WI-3 Enter while an input method is composing does not insert", () => {
  it("Enter with isComposing inserts nothing and keeps the dialog open", () => {
    const url = renderWithUrl("https://例");
    fireEvent.keyDown(url, { key: "Enter", isComposing: true });
    expect(inserted).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Enter with WebKit's IME keyCode 229 inserts nothing", () => {
    const url = renderWithUrl("https://例");
    fireEvent.keyDown(url, { key: "Enter", keyCode: 229 });
    expect(inserted).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("after the composition ends, a plain Enter inserts the URL once", () => {
    const url = renderWithUrl("https://例.com");
    fireEvent.keyDown(url, { key: "Enter", isComposing: true });
    fireEvent.keyDown(url, { key: "Enter", keyCode: 13 });
    expect(inserted).toEqual(["https://例.com"]);
  });
});
