import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
