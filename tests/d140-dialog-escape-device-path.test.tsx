/**
 * D140 — Escape on the encoding and reload dialogs, along the paths a device takes.
 *
 * Device record: `docs/test/20261011-encoding-819fa2c-device-check.md` item E4.
 *
 * What jsdom can and cannot say here. The E4 presses came from `kc.sh 53` (System Events
 * `key code 53`) and computer-use `key Escape`. Neither route has ever produced an Escape
 * `keydown` in mdpro: the D42 run (`docs/test/20261008-d42-device-check.md` § 2.1) saw 4 of 4
 * `key code 53` presses do nothing on the *registered* ConfirmDialog, and ADR-0048 records that
 * the computer-use Escape arrives as a `keyup` only. A physical Esc on the same backdrop pattern
 * worked (G-D42-1, `ui.dialog.cancel dialog.reload.ignore`). No first-party keydown listener in
 * capture phase eats Escape (only `useDialogEscape` listens there), so a `keydown` dispatched on
 * the focused Cancel closes the dialog today — DP-1 pins that.
 *
 * The defect that IS in the code: Escape is bound to focus inside the card. A mouse click on the
 * card's text (or on a button, which WebKit on macOS does not focus) leaves focus on `<body>`,
 * and from there the backdrop `onKeyDown` never hears the key — the D34 failure, fixed for
 * ConfirmDialog and MCP by the `useDialogEscape` stack and not for these two. DP-2 … DP-6 pin
 * the fix: both dialogs on the stack, one cancel per press through the dialog's own cancel path.
 *
 * Mock boundaries: `@tauri-apps/api/webviewWindow` (fake bus) and `@tauri-apps/api/core`
 * `invoke` (`log_event` → `logs`). `loggingService`, `useDialogEscape`, every dialog and the
 * window-level `useKeyboardShortcuts` listener App mounts are real.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Cb = (event: { payload: unknown }) => void;
type LogPayload = { event?: string; context?: Record<string, unknown>; [key: string]: unknown };

const { bus, logs } = vi.hoisted(() => ({
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  logs: [] as Array<{ event?: string; context?: Record<string, unknown>; [key: string]: unknown }>,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: Cb) => {
      const set = bus.window.get(name) ?? new Set<Cb>();
      set.add(cb);
      bus.window.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") logs.push((args.payload as LogPayload | undefined) ?? {});
    return null;
  },
}));

import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { useLoggingStore } from "../src/stores/loggingStore";
import {
  createAppDialogsHarness,
  dialogFor,
  type AppDialogsHarness,
} from "./support/appDialogsHarness";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string; resolved: string }; samples: Array<Record<string, unknown>> };
const replace = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;
const req = (id: string, title: string) => ({ ...replace, requestId: id, documentTitle: title });

const cancelLines = () =>
  logs.filter((p) => p.event === "ui.dialog.cancel").map((p) => p.context?.controlId);
const escapeLines = () => logs.filter((p) => p.event === "ui.dialog.escape").map((p) => p.context);

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.window.get(name) ?? [])]) cb({ payload });
    await Promise.resolve();
  });
}

/** A real Escape keydown as WKWebView delivers it: bubbles, composed, cancelable. */
function escapeOn(target: EventTarget, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  let ok = true;
  act(() => {
    ok = target.dispatchEvent(ev);
  });
  return { ev, ok };
}

/** App's window-level shortcut listener, mounted beside the dialogs as App mounts it. */
function GlobalShortcuts({ seen }: { seen: string[] }) {
  useKeyboardShortcuts({
    onClose: () => seen.push("close"),
    onSave: () => seen.push("save"),
    onOpen: () => seen.push("open"),
    onNew: () => seen.push("new"),
  });
  return null;
}

async function mountApp(): Promise<{ h: AppDialogsHarness; seen: string[] }> {
  const h = createAppDialogsHarness({ deliver, events: fx.events, request: req });
  const seen: string[] = [];
  render(
    <>
      <GlobalShortcuts seen={seen} />
      <h.Harness />
    </>,
  );
  await settle();
  return { h, seen };
}

const count = (h: AppDialogsHarness, handler: string) =>
  h.calls.filter((c) => c.handler === handler).length;

beforeEach(() => {
  bus.window.clear();
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("D140: Escape on the encoding and reload dialogs", () => {
  it("DP-1 Escape with focus on the encoding dialog's Cancel cancels exactly once", async () => {
    const { h, seen } = await mountApp();
    await h.open("encoding");
    await settle();
    const cancel = within(dialogFor("encoding") as HTMLElement).getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();

    escapeOn(cancel);
    await settle();

    expect(dialogFor("encoding")).toBeNull();
    expect(count(h, "encodingCancel")).toBe(1);
    expect(cancelLines()).toEqual(["dialog.encoding.cancel"]);
    expect(seen).toEqual([]);
  });

  it("DP-2 after a click on the encoding card's text, Escape still cancels it", async () => {
    const user = userEvent.setup();
    const { h } = await mountApp();
    await h.open("encoding");
    await settle();
    const card = dialogFor("encoding") as HTMLElement;
    await user.click(within(card).getByRole("heading"));
    expect(document.activeElement).toBe(document.body);

    const { ev } = escapeOn(document.body);
    await settle();

    expect(dialogFor("encoding")).toBeNull();
    expect(count(h, "encodingCancel")).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(cancelLines()).toEqual(["dialog.encoding.cancel"]);
    expect(escapeLines()).toStrictEqual([{ dialog: "encoding", outcome: "cancel" }]);
  });

  it("DP-3 with focus on <body>, Escape ignores the reload dialog", async () => {
    const user = userEvent.setup();
    const { h } = await mountApp();
    await h.open("reload");
    await settle();
    const card = dialogFor("reload") as HTMLElement;
    await user.click(within(card).getByRole("heading"));
    expect(document.activeElement).toBe(document.body);

    const { ev } = escapeOn(document.body);
    await settle();

    expect(dialogFor("reload")).toBeNull();
    expect(count(h, "ignoreReload")).toBe(1);
    expect(count(h, "reloadFile")).toBe(0);
    expect(ev.defaultPrevented).toBe(true);
    expect(cancelLines()).toEqual(["dialog.reload.ignore"]);
    expect(escapeLines()).toStrictEqual([{ dialog: "reload", outcome: "ignore" }]);
  });

  it("DP-4 the encoding dialog opened over Unsaved changes takes Escape from <body>; Unsaved stays", async () => {
    const { h } = await mountApp();
    await h.open("confirm");
    await h.open("encoding");
    await settle();
    act(() => (document.activeElement as HTMLElement | null)?.blur());

    escapeOn(document.body);
    await settle();

    expect(dialogFor("encoding")).toBeNull();
    expect(dialogFor("confirm")).not.toBeNull();
    expect(count(h, "encodingCancel")).toBe(1);
    expect(count(h, "cancelClose")).toBe(0);
    expect(escapeLines()).toStrictEqual([{ dialog: "encoding", outcome: "cancel" }]);
  });

  it("DP-5 one Escape on the focused Cancel is consumed: one cancel, nothing reaches the window", async () => {
    const { h } = await mountApp();
    await h.open("encoding");
    await settle();
    let windowSaw = 0;
    const onWindow = (e: KeyboardEvent) => {
      if (e.key === "Escape") windowSaw += 1;
    };
    window.addEventListener("keydown", onWindow);
    try {
      const cancel = within(dialogFor("encoding") as HTMLElement).getByRole("button", { name: "Cancel" });
      const { ev, ok } = escapeOn(cancel);
      await settle();
      expect(ok).toBe(false);
      expect(ev.defaultPrevented).toBe(true);
      expect(windowSaw).toBe(0);
      expect(count(h, "encodingCancel")).toBe(1);
      expect(cancelLines()).toEqual(["dialog.encoding.cancel"]);
    } finally {
      window.removeEventListener("keydown", onWindow);
    }
  });

  it("DP-6 an Escape that belongs to an IME composition cancels neither dialog", async () => {
    const { h } = await mountApp();
    await h.open("reload");
    await h.open("encoding");
    await settle();
    const cancel = screen.getByRole("button", { name: "Cancel" });

    escapeOn(cancel, { isComposing: true });
    await settle();

    expect(dialogFor("encoding")).not.toBeNull();
    expect(dialogFor("reload")).not.toBeNull();
    expect(h.calls).toEqual([]);
    expect(cancelLines()).toEqual([]);
  });
});
