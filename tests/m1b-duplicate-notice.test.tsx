import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());
vi.mock("../src/hooks/useRecoveryAdmission", () => ({ useRecoveryAdmission: () => ({ rows: [], mcpLink: null }) }));
vi.mock("../src/components/common/McpWriteConfirm", () => ({ McpWriteConfirm: () => null }));

import { AppDialogs } from "../src/components/AppDialogs";
import { quitDialogModel } from "../src/utils/quitDialogModel";

afterEach(cleanup);

it("M1b WI-13 names both suppressed commands and opens Keyboard Shortcuts from the launch notice", async () => {
  const openSettings = vi.fn();
  const dismiss = vi.fn();
  render(<AppDialogs
    drafts={[]} onRecoverDraft={() => {}} onDiscardDraft={() => {}}
    reloadMessage={null} onReload={() => {}} onIgnoreReload={() => {}}
    encodingIssue={null} onEncodingSelect={() => {}} onEncodingCancel={() => {}}
    confirmDialog={quitDialogModel({ pendingClose: null, quitPrompt: null })}
    onConfirmClose={() => {}} onCancelClose={() => {}}
    settingsOpen={false} onSettingsClose={() => {}}
    shortcutConflictMessage="New and Save both use Cmd+J. Both shortcuts are suppressed until restart."
    onShortcutConflictOpenSettings={openSettings} onShortcutConflictDismiss={dismiss}
  />);
  const dialog = screen.getByRole("dialog", { name: "Shortcut conflicts" });
  expect(dialog.textContent).toContain("New and Save both use Cmd+J");
  await userEvent.click(screen.getByRole("button", { name: "Open Keyboard Shortcuts" }));
  expect(openSettings).toHaveBeenCalledTimes(1);
  expect(dismiss).not.toHaveBeenCalled();
});
