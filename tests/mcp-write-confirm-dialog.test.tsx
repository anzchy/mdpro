/**
 * ADR-0042 WI-8 — `McpWriteConfirmDialog`, the in-window MCP write prompt.
 *
 * Cases D-1 … D-7 of `.claude/tdd-guardian/tests-20260929-102912.md`
 * (revision 2). The component is presentational: its behaviour is the finite
 * key/click → callback mapping below. The `onApprove` / `onReject` props are
 * the component's output, owned by the test.
 *
 * Mock boundary: only `@tauri-apps/api/core` (D34 WI-7, T-2). `loggingService` and
 * `loggingStore` are real; `invoke("log_event", { payload })` captures the JSONL payload
 * that would reach Rust (the `tests/use-dialog-escape.test.tsx` pattern). Paired real
 * path: `src-tauri/src/services/logger.rs` `mod tests` (Rust lane).
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type LogPayload = { event?: string; context?: Record<string, unknown>; [key: string]: unknown };

const { logs } = vi.hoisted(() => ({ logs: [] as LogPayload[] }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args?: { payload?: LogPayload }) => {
    if (cmd === "log_event") logs.push(args?.payload ?? {});
    return Promise.resolve(null);
  },
}));

import { McpWriteConfirmDialog } from "../src/components/common/McpWriteConfirmDialog";
import { useLoggingStore } from "../src/stores/loggingStore";
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

/**
 * D34 WI-7 (D-6): a host that owns the prompt the way `McpWriteConfirm` does — the
 * dialog unmounts once answered — opened while an outside input holds focus.
 */
function renderAnswerable() {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const user = userEvent.setup();
  function Host({ show }: { show: boolean }) {
    const [answered, setAnswered] = useState(false);
    return (
      <>
        <input aria-label="outside" />
        {show && !answered ? (
          <McpWriteConfirmDialog
            request={REQUEST}
            onApprove={() => {
              onApprove();
              setAnswered(true);
            }}
            onReject={() => {
              onReject();
              setAnswered(true);
            }}
          />
        ) : null}
      </>
    );
  }
  const view = render(<Host show={false} />);
  const outside = screen.getByRole("textbox", { name: "outside" });
  act(() => {
    outside.focus();
  });
  view.rerender(<Host show />);
  return { user, onApprove, onReject, outside };
}

const escapeLines = () => logs.filter((p) => p.event === "ui.dialog.escape");

beforeEach(() => {
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

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
    const seen = recordEscapes();
    try {
      await user.keyboard("{Escape}");
    } finally {
      seen.stop();
    }
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(0);
    // D34 WI-7 (D-3): the Escape was consumed, and the one line it wrote names the
    // dialog and the outcome only — never the request id or the document title.
    expect(seen.events).toHaveLength(1);
    expect(seen.events[0].defaultPrevented).toBe(true);
    expect(seen.leaked).toBe(0);
    expect(escapeLines()).toHaveLength(1);
    expect(escapeLines()[0]).toMatchObject({
      level: "info",
      status: "success",
      context: { dialog: "mcp_write_confirm", outcome: "reject" },
    });
    expect(Object.keys(escapeLines()[0].context ?? {}).sort()).toStrictEqual(["dialog", "outcome"]);
    expect(JSON.stringify(logs)).not.toMatch(/Q3 plan|req-7f3a|doc-91b/);
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
    const { user, onApprove, onReject, outside } = renderAnswerable();
    expect(rejectButton()).toHaveFocus();
    await user.click(approveButton());
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(0);
    // D34 WI-7 (D-6): what the user sees — the prompt is gone, focus is back where it was
    // when the prompt opened (so typing resumes there), and the click wrote no Escape line.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(outside).toHaveFocus();
    expect(escapeLines()).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// D34 WI-3 — Escape goes through the shared `useDialogEscape` stack (D-8 … D-12 of
// `.claude/tdd-guardian/tests-20261001-100508.md`). jsdom cannot reproduce WKWebView
// focus: "blur to body" simulates the D34 hypothesis only.
// ---------------------------------------------------------------------------

let editorEsc = 0;

function renderWithOutside() {
  editorEsc = 0;
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <input aria-label="outside" />
      <div
        contentEditable="true"
        suppressContentEditableWarning
        tabIndex={0}
        className="ProseMirror"
        role="textbox"
        aria-label="editor"
        onKeyDown={(e) => {
          if (e.key === "Escape") editorEsc += 1;
        }}
      />
      <McpWriteConfirmDialog request={REQUEST} onApprove={onApprove} onReject={onReject} />
    </>,
  );
  return { user, onApprove, onReject };
}

function blurToBody() {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(document.activeElement).toBe(document.body);
}

function focusOn(el: HTMLElement) {
  act(() => {
    el.focus();
  });
  expect(el).toHaveFocus();
}

/** Raw dispatch: reads the `dispatchEvent` return value and sets flags userEvent cannot. */
function escapeOn(target: EventTarget, extra: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...extra });
  let ok = true;
  act(() => {
    ok = target.dispatchEvent(ev);
  });
  return { ev, ok };
}

/**
 * D34 WI-6 (T-1): records every Escape keydown at `window` capture (which runs before the
 * hook's `document` capture listener) so a `userEvent` case can read `defaultPrevented`
 * after dispatch, and counts any that leak to a `window` bubble listener.
 */
function recordEscapes() {
  const events: KeyboardEvent[] = [];
  let leaked = 0;
  const capture = (e: KeyboardEvent) => {
    if (e.key === "Escape") events.push(e);
  };
  const bubble = (e: KeyboardEvent) => {
    if (e.key === "Escape") leaked += 1;
  };
  window.addEventListener("keydown", capture, true);
  window.addEventListener("keydown", bubble);
  return {
    events,
    get leaked() {
      return leaked;
    },
    stop() {
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("keydown", bubble);
    },
  };
}

type FocusClass ="body" | "outside" | "editor" | "reject" | "approve";

function focusClass(kind: FocusClass) {
  switch (kind) {
    case "body":
      blurToBody();
      return;
    case "outside":
      focusOn(screen.getByRole("textbox", { name: "outside" }));
      return;
    case "editor":
      focusOn(screen.getByRole("textbox", { name: "editor" }));
      return;
    case "reject":
      focusOn(rejectButton());
      return;
    case "approve":
      focusOn(approveButton());
      return;
  }
}

describe("McpWriteConfirmDialog Escape through the shared stack (D34 WI-3)", () => {
  it("D-8: Escape with focus on body rejects (RED reproducer)", async () => {
    const { user, onApprove, onReject } = renderDialog();
    expect(rejectButton()).toHaveFocus();
    blurToBody();
    const seen = recordEscapes();
    try {
      await user.keyboard("{Escape}");
    } finally {
      seen.stop();
    }
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(0);
    // D34 WI-6 (T-1): the Escape was consumed, not merely observed.
    expect(seen.events).toHaveLength(1);
    expect(seen.events[0].defaultPrevented).toBe(true);
    expect(seen.leaked).toBe(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("D-9: Escape with focus on an outside textbox rejects (RED reproducer)", async () => {
    const { user, onApprove, onReject } = renderWithOutside();
    const outside = screen.getByRole("textbox", { name: "outside" });
    await user.click(outside);
    expect(outside).toHaveFocus();
    const seen = recordEscapes();
    try {
      await user.keyboard("{Escape}");
    } finally {
      seen.stop();
    }
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(0);
    // D34 WI-6 (T-1): consumed at the document, so the textbox never saw it and kept focus.
    expect(seen.events).toHaveLength(1);
    expect(seen.events[0].defaultPrevented).toBe(true);
    expect(seen.events[0].target).toBe(outside);
    expect(seen.leaked).toBe(0);
    expect(outside).toHaveFocus();
    expect(outside).toHaveValue("");
  });

  it("D-9b: a raw Escape dispatched on the outside textbox returns false (consumed)", () => {
    const { onApprove, onReject } = renderWithOutside();
    const outside = screen.getByRole("textbox", { name: "outside" });
    focusOn(outside);
    const { ev, ok } = escapeOn(outside);
    expect(ok).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(0);
  });

  it.each<FocusClass>(["body", "outside", "editor", "reject", "approve"])(
    "D-10: Escape with focus on %s rejects exactly once and never approves",
    async (kind) => {
      const { user, onApprove, onReject } = renderWithOutside();
      focusClass(kind);
      await user.keyboard("{Escape}");
      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onApprove).toHaveBeenCalledTimes(0);
      expect(editorEsc).toBe(0);
    },
  );

  it("D-11: a repeat Escape does not reject and is not leaked", () => {
    const { onApprove, onReject } = renderDialog();
    const { ok } = escapeOn(rejectButton(), { repeat: true });
    expect(ok).toBe(false);
    expect(onReject).toHaveBeenCalledTimes(0);
    expect(onApprove).toHaveBeenCalledTimes(0);
  });

  it("D-12: an IME-composing Escape in the editor does not reject", () => {
    const { onApprove, onReject } = renderWithOutside();
    const editor = screen.getByRole("textbox", { name: "editor" });
    focusOn(editor);
    const { ev, ok } = escapeOn(editor, { isComposing: true });
    expect(ok).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    expect(onReject).toHaveBeenCalledTimes(0);
    expect(onApprove).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// D63 — initial focus on Reject is requested as *visible* focus, exactly once per mount.
//
// Same defect as D53 (ConfirmDialog): WKWebView does not match `:focus-visible` for an
// autofocus/script focus after a mouse interaction, so rule 33 pattern 2 drew no ring on
// Reject. The focus TARGET is unchanged (Reject, ADR-0042 FT-1) — only the request changes.
// The spy records focus requests (target + options) and calls through to jsdom's focus.
// Only requests made while mounting are counted: `useReturnFocusOnClose` may focus on unmount,
// which is D37's behaviour (D-6, RF tests), not this one. Mock boundary: the file's Tauri mock.
// ---------------------------------------------------------------------------

describe("McpWriteConfirmDialog visible initial focus (D63)", () => {
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

  it("MW-1: mount — exactly one focus request, on Reject, with focusVisible: true; Approve never", () => {
    renderDialog();
    expect(focusCalls).toHaveLength(1);
    expect(focusCalls[0].el).toBe(rejectButton());
    expect(visibleFlag(focusCalls[0])).toBe(true);
    expect(rejectButton()).toHaveFocus();
    expect(focusCalls.some((c) => c.el === approveButton())).toBe(false);
  });

  it("MW-2: opened while an outside input holds focus — one visible request on Reject", () => {
    const { outside } = renderAnswerable();
    // The test's own outside.focus() precedes the mount; count only the dialog's requests.
    const mountCalls = focusCalls.filter((c) => c.el !== outside);
    expect(mountCalls).toHaveLength(1);
    expect(mountCalls[0].el).toBe(rejectButton());
    expect(visibleFlag(mountCalls[0])).toBe(true);
    expect(rejectButton()).toHaveFocus();
  });

  it("MW-3: re-rendering the same prompt does not refocus — a user's focus move is kept", () => {
    const { rerender, onApprove, onReject } = renderDialog();
    expect(focusCalls).toHaveLength(1);
    act(() => {
      approveButton().focus();
    });
    const afterMove = focusCalls.length;
    rerender(<McpWriteConfirmDialog request={REQUEST} onApprove={onApprove} onReject={onReject} />);
    rerender(
      <McpWriteConfirmDialog request={{ ...REQUEST, expiresInMs: 30000 }} onApprove={onApprove} onReject={onReject} />,
    );
    expect(focusCalls.slice(afterMove)).toStrictEqual([]);
    expect(approveButton()).toHaveFocus();
  });
});
