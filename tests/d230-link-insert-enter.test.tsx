/**
 * D230-WI-2 (audit b152 M2): with D230's Tab loop a keyboard user can reach
 * Cancel, but the dialog's keydown handler submitted on Enter wherever focus
 * was, so Tab to Cancel then Enter inserted the link. Enter now submits only
 * from the URL field; on a button, Enter activates that button.
 *
 * Mocked only at the Tauri boundary; the real store and modal run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { LinkInsertModal } from "../src/components/Editor/LinkInsertModal";

let inserted: string[];

function renderOpen() {
  render(<LinkInsertModal />);
  act(() => useLinkInsertStore.getState().setPendingCallback((url: string) => inserted.push(url), "wysiwyg"));
  const url = screen.getByRole("textbox", { name: "URL" });
  act(() => url.focus());
  return { url };
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

describe("D230-WI-2 Enter submits only from the URL field", () => {
  it("Tab to Cancel, then Enter, cancels and inserts nothing", async () => {
    const user = userEvent.setup();
    const { url } = renderOpen();
    await user.type(url, "https://x.io");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Enter}");
    expect(inserted).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Space on Cancel also inserts nothing", async () => {
    const user = userEvent.setup();
    const { url } = renderOpen();
    await user.type(url, "https://x.io");
    await user.tab();
    await user.keyboard(" ");
    expect(inserted).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Enter in the URL field inserts the trimmed URL once", async () => {
    const user = userEvent.setup();
    const { url } = renderOpen();
    await user.type(url, "  https://x.io  {Enter}");
    expect(inserted).toEqual(["https://x.io"]);
  });

  it("Enter on Insert inserts the URL exactly once", async () => {
    const user = userEvent.setup();
    const { url } = renderOpen();
    await user.type(url, "https://x.io");
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Insert" }));
    await user.keyboard("{Enter}");
    expect(inserted).toEqual(["https://x.io"]);
  });

  it("Enter in an empty URL field inserts nothing and keeps the dialog open", async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.keyboard("{Enter}");
    expect(inserted).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
