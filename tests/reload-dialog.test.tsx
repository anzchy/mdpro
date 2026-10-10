import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReloadDialog } from "../src/components/common/ReloadDialog";

// Boundary mock: the real service writes JSONL through Tauri IPC, which does not
// exist in jsdom. The dialog's own behaviour is what's under test.
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logDialogAction: vi.fn() },
}));

describe("ReloadDialog", () => {
  it("dismisses via Escape and reports ignore, not reload", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const onIgnore = vi.fn();

    render(
      <ReloadDialog
        open
        message="notes.md changed on disk"
        onReload={onReload}
        onIgnore={onIgnore}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Reload file" })).toBeInTheDocument();

    // Escape is handled on the backdrop, which is not itself focusable, so the
    // key only reaches it by bubbling from the autoFocused button. If focus were
    // lost the keystroke would land on document.body — outside React's root —
    // and the assertion below would pass for the wrong reason.
    expect(screen.getByRole("button", { name: "Reload" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(onIgnore).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
  });

  it("leaves no mounted dialog behind for the following test", () => {
    // Nothing is rendered here. A dialog found now could only have survived the
    // previous test, which is exactly what afterEach(cleanup) in tests/setup.ts
    // is there to prevent.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders nothing while closed", () => {
    render(
      <ReloadDialog open={false} message="notes.md changed on disk" onReload={vi.fn()} onIgnore={vi.fn()} />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D63 — initial focus on Reload is requested as *visible* focus, exactly once per open.
//
// Same defect as D53 (ConfirmDialog): WKWebView does not match `:focus-visible` for an
// autofocus/script focus after a mouse interaction, so rule 33 pattern 2 drew no ring on
// Reload. The focus TARGET is unchanged (Reload; default-button policy is D59/D32) — only the
// request changes. The spy records focus requests (target + options) and calls through to
// jsdom's focus, so `toHaveFocus` checks where focus landed. Mock boundary: none beyond the
// file's loggingService mock. The device check (ring visible) proves the ring itself.
// ---------------------------------------------------------------------------

describe("ReloadDialog visible initial focus (D63)", () => {
  type FocusCall = { el: HTMLElement; options: FocusOptions | undefined };
  let focusCalls: FocusCall[];
  let focusSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    focusCalls = [];
    const original = HTMLElement.prototype.focus;
    focusSpy = vi
      .spyOn(HTMLElement.prototype, "focus")
      .mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
        focusCalls.push({ el: this, options });
        original.call(this, options);
      });
  });

  afterEach(() => {
    focusSpy?.mockRestore();
    focusSpy = null;
  });

  const visibleFlag = (c: FocusCall) => (c.options as { focusVisible?: boolean } | undefined)?.focusVisible;

  function D63Dialog({ open, message = "notes.md changed on disk" }: { open: boolean; message?: string }) {
    return <ReloadDialog open={open} message={message} onReload={() => {}} onIgnore={() => {}} />;
  }

  it("RD-1: open — exactly one focus request, on Reload, with focusVisible: true", () => {
    render(<D63Dialog open />);
    const reload = screen.getByRole("button", { name: "Reload" });
    expect(focusCalls).toHaveLength(1);
    expect(focusCalls[0].el).toBe(reload);
    expect(visibleFlag(focusCalls[0])).toBe(true);
    expect(reload).toHaveFocus();
    expect(screen.getByRole("button", { name: "Ignore" })).not.toHaveFocus();
  });

  it("RD-2: closed — renders nothing and requests no focus", () => {
    render(<D63Dialog open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(focusCalls).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("RD-3: re-rendering while open does not refocus — a user's focus move is kept", () => {
    const view = render(<D63Dialog open />);
    const ignore = screen.getByRole("button", { name: "Ignore" });
    expect(focusCalls).toHaveLength(1);
    act(() => {
      ignore.focus();
    });
    const afterMove = focusCalls.length;
    view.rerender(<D63Dialog open />);
    view.rerender(<D63Dialog open message="other.md changed on disk" />);
    expect(focusCalls.slice(afterMove)).toStrictEqual([]);
    expect(ignore).toHaveFocus();
  });

  it("RD-4: close then reopen requests visible focus on Reload again, once", () => {
    const view = render(<D63Dialog open />);
    expect(focusCalls).toHaveLength(1);
    view.rerender(<D63Dialog open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<D63Dialog open />);
    const reload = screen.getByRole("button", { name: "Reload" });
    expect(focusCalls).toHaveLength(2);
    expect(focusCalls[1].el).toBe(reload);
    expect(visibleFlag(focusCalls[1])).toBe(true);
    expect(reload).toHaveFocus();
  });
});
