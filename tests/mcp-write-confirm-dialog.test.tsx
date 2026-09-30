/**
 * ADR-0042 WI-8 — `McpWriteConfirmDialog`, the in-window MCP write prompt.
 *
 * Cases D-1 … D-7 of `.claude/tdd-guardian/tests-20260929-102912.md`
 * (revision 2). The component is presentational: its behaviour is the finite
 * key/click → callback mapping below. The `onApprove` / `onReject` props are
 * the component's output, owned by the test. Only `loggingService` is mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

import { McpWriteConfirmDialog } from "../src/components/common/McpWriteConfirmDialog";
import type { ConfirmRequest } from "../src/utils/mcpConfirmModel";

const REQUEST: ConfirmRequest = {
  requestId: "req-7f3a",
  documentId: "doc-91b",
  documentTitle: "Q3 plan.md",
  operation: "replace",
  expiresInMs: 60000,
};

function renderDialog(request: ConfirmRequest = REQUEST) {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <McpWriteConfirmDialog request={request} onApprove={onApprove} onReject={onReject} />,
  );
  return { ...view, user, onApprove, onReject };
}

const dialog = () => screen.getByRole("dialog", { name: /write confirmation/i });
const rejectButton = () => screen.getByRole("button", { name: "Reject" });
const approveButton = () => screen.getByRole("button", { name: "Approve" });

afterEach(() => {
  Reflect.deleteProperty(window, "__pwned");
});

describe("McpWriteConfirmDialog (WI-8)", () => {
  it("D-1 queryable by role and name; message shows the title, never an id", () => {
    renderDialog();
    const el = dialog();
    expect(el).toHaveAttribute("aria-modal", "true");
    expect(el).toHaveAccessibleDescription(/Q3 plan\.md/);
    expect(document.body.textContent).not.toContain("req-7f3a");
    expect(document.body.textContent).not.toContain("doc-91b");
  });

  it("D-2 initial focus is Reject, and Enter on open rejects", async () => {
    const { user, onApprove, onReject } = renderDialog();
    expect(rejectButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(0);
  });

  it("D-3 Escape rejects", async () => {
    const { user, onApprove, onReject } = renderDialog();
    await user.keyboard("{Escape}");
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(0);
  });

  it("D-4 Tab and Shift+Tab wrap inside the dialog", async () => {
    const { user } = renderDialog();
    expect(document.activeElement).toBe(rejectButton());
    await user.tab();
    expect(document.activeElement).toBe(approveButton());
    await user.tab();
    expect(document.activeElement).toBe(rejectButton());
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(approveButton());
  });

  it("D-5 backdrop click rejects, card click does nothing", async () => {
    const { user, onApprove, onReject } = renderDialog();
    await user.click(screen.getByText(/Q3 plan\.md/));
    expect(onReject).toHaveBeenCalledTimes(0);
    expect(onApprove).toHaveBeenCalledTimes(0);
    const backdrop = dialog().parentElement;
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as HTMLElement);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(0);
  });

  it("D-6 Approve click approves", async () => {
    const { user, onApprove, onReject } = renderDialog();
    await user.click(approveButton());
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(0);
  });

  it("D-7 a hostile title is rendered as text", () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    const { container } = renderDialog({ ...REQUEST, documentTitle: hostile });
    const describedBy = dialog().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy as string);
    expect(description?.textContent).toContain(hostile);
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
  });
});
