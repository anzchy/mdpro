/**
 * D230: Tab and Shift-Tab left the Insert Link dialog for the UI behind its
 * overlay (Stage 3 batch 5 device check, both themes). Rule 33 asks every
 * modal to keep Tab inside it: Tab on the last enabled control wraps to the
 * first, Shift-Tab on the first wraps to the last. "Insert" is disabled while
 * the URL is empty, so the last stop moves between Cancel and Insert.
 *
 * Mocked only at the Tauri boundary; the real store and modal run, with
 * focusable controls rendered before and after the dialog as the "UI behind".
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

function renderOpen() {
  render(
    <>
      <button type="button">behind before</button>
      <LinkInsertModal />
      <button type="button">behind after</button>
    </>,
  );
  act(() => useLinkInsertStore.getState().setPendingCallback(() => {}, "wysiwyg"));
  const url = screen.getByRole("textbox", { name: "URL" });
  act(() => url.focus());
  return {
    url,
    cancel: screen.getByRole("button", { name: "Cancel" }),
    insert: screen.getByRole("button", { name: "Insert" }),
  };
}

beforeEach(() => {
  useLinkInsertStore.setState({ pendingCallback: null, mode: "wysiwyg" });
  // The modal focuses the URL field in a requestAnimationFrame. Run it at once,
  // so a frame that fires late under a loaded runner can't pull focus back
  // after the test has moved it.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  act(() => useLinkInsertStore.getState().clearPendingCallback());
  vi.unstubAllGlobals();
});

describe("D230 Insert Link keeps Tab inside the dialog", () => {
  it("with an empty URL, Tab from Cancel (the last enabled stop) returns to the URL field", async () => {
    const user = userEvent.setup();
    const { url, cancel } = renderOpen();
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(url);
  });

  it("with an empty URL, Shift-Tab from the URL field goes to Cancel, not the UI behind", async () => {
    const user = userEvent.setup();
    const { cancel } = renderOpen();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
  });

  it("with a URL typed, Tab from Insert returns to the URL field", async () => {
    const user = userEvent.setup();
    const { url, cancel, insert } = renderOpen();
    await user.type(url, "https://x.io");
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(insert);
    await user.tab();
    expect(document.activeElement).toBe(url);
  });

  it("with a URL typed, Shift-Tab from the URL field goes to Insert", async () => {
    const user = userEvent.setup();
    const { url, insert } = renderOpen();
    await user.type(url, "https://x.io");
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(insert);
  });

  it("never lands on a control behind the overlay over a full cycle each way", async () => {
    const user = userEvent.setup();
    renderOpen();
    const behind = screen.getAllByRole("button", { name: /^behind/ });
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(behind).not.toContain(document.activeElement);
    }
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true });
      expect(behind).not.toContain(document.activeElement);
    }
  });
});
