/**
 * D34 WI-2 — `ConfirmDialog` joins the shared Escape stack; Escape means Cancel.
 *
 * Specification: `.claude/tdd-guardian/tests-20261001-100508.md`, cases CD-1 … CD-10.
 *
 * Law (observational equivalence): a qualifying Escape on an open dialog produces the same
 * transition (`onCancel` once, `onConfirm` never, dialog closed) and the same
 * `ui.dialog.cancel` payload as a Cancel click, plus exactly one
 * `ui.dialog.escape {dialog:"confirm", outcome:"cancel"}`. Covered at S6 by CD-4 and at S5
 * by CD-6.
 *
 * Mock boundary: only `@tauri-apps/api/core`; `loggingService` / `loggingStore` are real and
 * `invoke("log_event", { payload })` captures the JSONL payload that would reach Rust.
 * Paired real path: `src-tauri/src/services/logger.rs` `mod tests` (Rust lane).
 *
 * jsdom cannot reproduce WKWebView focus: "blur to body" simulates the D34 hypothesis only;
 * the device check (E2E-D34-device) is what proves the fix.
 */
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

import { ConfirmDialog } from "../src/components/common/ConfirmDialog";
import { useLoggingStore } from "../src/stores/loggingStore";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let cancels = 0;
let confirms = 0;
let outsideEsc = 0;

function Host({ initialOpen = true, withToggle = false }: { initialOpen?: boolean; withToggle?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [branch, setBranch] = useState("");
  return (
    <>
      <input
        aria-label="outside"
        onKeyDown={(e) => {
          if (e.key === "Escape") outsideEsc += 1;
        }}
      />
      {withToggle ? (
        <button type="button" onClick={() => setOpen((o) => !o)}>
          toggle
        </button>
      ) : null}
      <ConfirmDialog
        open={open}
        title="Unsaved changes"
        message="Save secret-plan.md?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          confirms += 1;
          setBranch("confirm");
          setOpen(false);
        }}
        onCancel={() => {
          cancels += 1;
          setBranch("cancel");
          setOpen(false);
        }}
      />
      <output aria-label="branch">{branch}</output>
    </>
  );
}

const dialog = () => screen.queryByRole("dialog", { name: "Unsaved changes" });
const dialogLines = () => logs.filter((p) => typeof p.event === "string" && p.event.startsWith("ui.dialog."));
const escapeLines = () => logs.filter((p) => p.event === "ui.dialog.escape");
const project = (p: LogPayload) => ({ event: p.event, status: p.status, level: p.level, context: p.context });

/** Raw dispatch: lets a case read `defaultPrevented` / the return value and set `repeat`. */
function escapeOn(target: EventTarget, extra: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...extra });
  let ok = true;
  act(() => {
    ok = target.dispatchEvent(ev);
  });
  return { ev, ok };
}

function blurToBody() {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(document.activeElement).toBe(document.body);
}

let probe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  logs.length = 0;
  cancels = 0;
  confirms = 0;
  outsideEsc = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  probe = vi.fn();
  window.addEventListener("keydown", probe);
});

afterEach(() => {
  window.removeEventListener("keydown", probe);
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("ConfirmDialog Escape (D34 WI-2)", () => {
  it("CD-1: Escape with focus on body cancels (RED reproducer)", async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByRole("button", { name: "Discard changes" })).toHaveFocus();
    blurToBody();
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(cancels).toBe(1);
    expect(confirms).toBe(0);
    expect(screen.getByRole("status", { name: "branch" })).toHaveTextContent("cancel");
  });

  it("CD-2: Escape with focus on an outside textbox cancels; the textbox never sees it (RED reproducer)", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const outside = screen.getByRole("textbox", { name: "outside" });
    await user.click(outside);
    expect(outside).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(cancels).toBe(1);
    expect(confirms).toBe(0);
    expect(outsideEsc).toBe(0);
  });

  it("CD-3: Escape with focus on the autoFocused destructive button cancels, never confirms", async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByRole("button", { name: "Discard changes" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(cancels).toBe(1);
    expect(confirms).toBe(0);
    expect(dialog()).toBeNull();
  });

  it("CD-4: the Escape path logs and transitions like a Cancel click, plus one escape line", async () => {
    // Run X: Cancel click.
    let user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    const x = dialogLines();
    expect(cancels).toBe(1);
    expect(confirms).toBe(0);
    expect(dialog()).toBeNull();
    cleanup();
    logs.length = 0;
    cancels = 0;

    // Run Y: Escape with focus on body.
    user = userEvent.setup();
    render(<Host />);
    blurToBody();
    await user.keyboard("{Escape}");
    const y = dialogLines();
    expect(cancels).toBe(1);
    expect(confirms).toBe(0);
    expect(dialog()).toBeNull();

    expect(x.length).toBeGreaterThan(0);
    expect(x.some((l) => l.event === "ui.dialog.cancel" && l.context?.controlId === "dialog.confirm.cancel")).toBe(
      true,
    );
    expect(y.filter((l) => l.event !== "ui.dialog.escape").map(project)).toStrictEqual(x.map(project));
    const esc = y.filter((l) => l.event === "ui.dialog.escape");
    expect(esc).toHaveLength(1);
    expect(esc[0].context).toStrictEqual({ dialog: "confirm", outcome: "cancel" });
    const serialized = JSON.stringify(esc[0]);
    expect(serialized).not.toContain("Unsaved changes");
    expect(serialized).not.toContain("secret-plan");
  });

  it.each([
    ["plain Escape, never opened", false],
    ["repeat Escape, after an open/close", true],
  ])("CD-5: a closed dialog consumes nothing — %s", async (_label, repeat) => {
    if (repeat) {
      const user = userEvent.setup();
      render(<Host />);
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(dialog()).toBeNull();
    } else {
      render(<Host initialOpen={false} />);
    }
    const before = cancels;
    const { ev, ok } = escapeOn(document.body, repeat ? { repeat: true } : {});
    expect(ok).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    expect(probe).toHaveBeenCalledWith(ev);
    expect(cancels).toBe(before);
    expect(escapeLines()).toHaveLength(0);
  });

  it("CD-6: toggling open 10 times, then one Escape → exactly one cancel", async () => {
    const user = userEvent.setup();
    render(<Host initialOpen={false} withToggle />);
    const toggle = screen.getByRole("button", { name: "toggle" });
    for (let i = 0; i < 10; i += 1) {
      await user.click(toggle);
      expect(dialog()).not.toBeNull();
      await user.click(toggle);
      expect(dialog()).toBeNull();
    }
    await user.click(toggle);
    expect(dialog()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(cancels).toBe(1);
    expect(dialog()).toBeNull();
    expect(escapeLines()).toHaveLength(1);

    const second = escapeOn(document.body);
    expect(second.ok).toBe(true);
    expect(second.ev.defaultPrevented).toBe(false);
    expect(cancels).toBe(1);
  });

  it("CD-7: nested in an ancestor with its own Escape onKeyDown — only ConfirmDialog closes", async () => {
    function Ancestor({ children }: { children: ReactNode }) {
      const [aOpen, setAOpen] = useState(true);
      return aOpen ? (
        <div
          role="dialog"
          aria-label="Settings stand-in"
          onKeyDown={(e) => {
            if (e.key === "Escape") setAOpen(false);
          }}
        >
          <button type="button">inside settings</button>
          {children}
        </div>
      ) : null;
    }
    const user = userEvent.setup();
    render(
      <Ancestor>
        <Host />
      </Ancestor>,
    );
    expect(screen.getByRole("button", { name: "Discard changes" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(cancels).toBe(1);
    expect(screen.getByRole("dialog", { name: "Settings stand-in" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "inside settings" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Settings stand-in" })).toBeNull();
    expect(cancels).toBe(1);
  });

  it("CD-8a: a Cancel click maps to onCancel", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(cancels).toBe(1);
    expect(confirms).toBe(0);
    expect(dialog()).toBeNull();
  });

  it("CD-8b: a Confirm click maps to onConfirm and logs ui.dialog.confirm, no escape line", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(confirms).toBe(1);
    expect(cancels).toBe(0);
    expect(dialog()).toBeNull();
    const lines = dialogLines();
    expect(lines.some((l) => l.event === "ui.dialog.confirm" && l.context?.controlId === "dialog.confirm.confirm")).toBe(
      true,
    );
    expect(lines.some((l) => l.event === "ui.dialog.escape")).toBe(false);
  });

  it("CD-9: after Confirm closes the dialog, Escape is no longer consumed", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    const { ev, ok } = escapeOn(document.body);
    expect(ok).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    expect(probe).toHaveBeenCalledWith(ev);
    expect(cancels).toBe(0);
  });

  it("CD-10: a new onCancel prop after re-render is the one Escape calls", async () => {
    function VariantHost({ variant }: { variant: "a" | "b" }) {
      const [open, setOpen] = useState(true);
      const [which, setWhich] = useState("");
      const cancelA = () => {
        setWhich("a");
        setOpen(false);
      };
      const cancelB = () => {
        setWhich("b");
        setOpen(false);
      };
      return (
        <>
          <ConfirmDialog
            open={open}
            title="Unsaved changes"
            message="Save secret-plan.md?"
            onConfirm={() => setOpen(false)}
            onCancel={variant === "a" ? cancelA : cancelB}
          />
          <output aria-label="which">{which}</output>
        </>
      );
    }
    const user = userEvent.setup();
    const view = render(<VariantHost variant="a" />);
    view.rerender(<VariantHost variant="b" />);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("status", { name: "which" })).toHaveTextContent("b");
    expect(screen.getByRole("status", { name: "which" })).not.toHaveTextContent("a");
    expect(dialog()).toBeNull();
  });
});
