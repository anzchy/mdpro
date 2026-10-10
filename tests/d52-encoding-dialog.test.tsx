/**
 * D52 (ADR-0057 decisions 1-3) — EncodingDialog offers only the encodings that can
 * be right, and opens on Cancel.
 *
 * - ED-1 the buttons are exactly UTF-16LE, UTF-16BE, Cancel (no UTF-8, no ASCII:
 *   the dialog opens only after detection ruled both out).
 * - ED-2 Cancel has focus on open (Enter must not commit a retry).
 * - ED-3 Escape takes Cancel; ED-4 a backdrop click takes Cancel, a click in the
 *   card does not.
 * - ED-5 each UTF-16 button selects its own encoding.
 * - ED-6 every visible string comes from `ENCODING_DIALOG_COPY`.
 *
 * Mock boundary: `loggingService` (Tauri IPC does not exist in jsdom).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EncodingDialog } from "../src/components/common/EncodingDialog";
import { ENCODING_DIALOG_COPY } from "../src/components/common/encodingDialogCopy";

vi.mock("../src/services/loggingService", () => ({
  loggingService: { logDialogAction: vi.fn() },
}));

function renderDialog() {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  render(
    <EncodingDialog open path="/x/gb.md" onSelect={onSelect} onCancel={onCancel} />,
  );
  const dialog = screen.getByRole("dialog", { name: ENCODING_DIALOG_COPY.ariaLabel });
  return { onSelect, onCancel, dialog };
}

describe("D52 EncodingDialog", () => {
  it("ED-1 offers exactly UTF-16LE, UTF-16BE and Cancel", () => {
    const { dialog } = renderDialog();
    const names = within(dialog).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual([
      ENCODING_DIALOG_COPY.utf16le,
      ENCODING_DIALOG_COPY.utf16be,
      ENCODING_DIALOG_COPY.cancel,
    ]);
    expect(within(dialog).queryByRole("button", { name: "UTF-8" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "ASCII" })).toBeNull();
  });

  it("ED-2 opens with focus on Cancel", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: ENCODING_DIALOG_COPY.cancel })).toHaveFocus();
  });

  it("ED-2 Enter on open cancels instead of retrying", async () => {
    const user = userEvent.setup();
    const { onSelect, onCancel } = renderDialog();
    await user.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ED-3 Escape takes Cancel", async () => {
    const user = userEvent.setup();
    const { onSelect, onCancel } = renderDialog();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ED-4 a backdrop click takes Cancel; a click inside the card does not", async () => {
    const user = userEvent.setup();
    const { onSelect, onCancel, dialog } = renderDialog();
    await user.click(within(dialog).getByText(ENCODING_DIALOG_COPY.title));
    expect(onCancel).not.toHaveBeenCalled();
    const backdrop = dialog.parentElement as HTMLElement;
    await user.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    [ENCODING_DIALOG_COPY.utf16le, "UTF-16LE"],
    [ENCODING_DIALOG_COPY.utf16be, "UTF-16BE"],
  ])("ED-5 %s selects %s", async (label, encoding) => {
    const user = userEvent.setup();
    const { onSelect, onCancel } = renderDialog();
    await user.click(screen.getByRole("button", { name: label }));
    expect(onSelect.mock.calls).toEqual([[encoding]]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ED-6 shows the title, body, retry hint and path from the copy object", () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByText(ENCODING_DIALOG_COPY.title)).toBeInTheDocument();
    expect(within(dialog).getByText(ENCODING_DIALOG_COPY.body)).toBeInTheDocument();
    expect(within(dialog).getByText(ENCODING_DIALOG_COPY.retryHint)).toBeInTheDocument();
    expect(within(dialog).getByText("/x/gb.md")).toBeInTheDocument();
  });

  it("ED-6 the copy names the legacy encodings it cannot open", () => {
    expect(ENCODING_DIALOG_COPY.body).toMatch(/GBK/);
    expect(ENCODING_DIALOG_COPY.refusedToast).toMatch(/UTF-16/);
  });
});
