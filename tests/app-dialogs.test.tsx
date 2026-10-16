/**
 * D42 WI-3 — `AppDialogs`, the App-level dialog composition extracted from App.tsx.
 *
 * Specification: `.claude/tdd-guardian/tests-20261008-131500.md`, cases 3.1 … 3.4
 * (3.5 (a)(b) are the retargeted `mcp-confirm-wiring` / `data-loss-logic` supplements,
 * 3.5 (c)(d) live in `app-dialogs-wiring.test.ts`).
 *
 * Law: none. A pass-through composition: each slot's visibility is a function of its own
 * input and each control routes to exactly one handler. **Deliberately, no case here pins
 * the relative DOM order of two dialogs** — WI-4 changes that order, and a recorded
 * assertion on it would have to be edited (policy rule 12).
 *
 * Mock boundaries (MB-T): `@tauri-apps/api/webviewWindow` (a fake bus) and
 * `@tauri-apps/api/core` `invoke`, routed: `log_event` → `logs`, `mcp_confirm_reply` →
 * recorded, the SettingsDialog loads → fixtures. `loggingService` / `loggingStore` are real.
 * Paired real paths (PAIR-T): `services/mcp_confirm/payload_tests.rs::p1_event_names_match_the_contract`,
 * `services/logger.rs` `mod tests`, and device checks G-D42-1/2/3.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Cb = (event: { payload: unknown }) => void;
type LogPayload = { event?: string; context?: Record<string, unknown>; [key: string]: unknown };

const { bus, core, logs } = vi.hoisted(() => ({
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  core: { calls: [] as Array<{ cmd: string; args: Record<string, unknown> }> },
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
    if (cmd === "log_event") {
      logs.push((args.payload as LogPayload | undefined) ?? {});
      return null;
    }
    core.calls.push({ cmd, args: { ...args } });
    switch (cmd) {
      case "mcp_confirm_reply":
        return "resolved";
      case "get_preferences":
        return (await import("./support/preferenceFixtures")).makePreferences();
      case "mcp_get_status":
        return { running: false, port: null, binaryPath: "b", phase: "disabled", error: null, configured: "disabled" };
      case "mcp_get_installations":
        return [];
      default:
        return null;
    }
  },
}));

import { useLoggingStore } from "../src/stores/loggingStore";
import { CLOSE_DIALOG_MESSAGE, QUIT_DIALOG_MESSAGE } from "../src/utils/quitDialogModel";
import {
  DIALOG_NAME,
  HARNESS_DIALOG_IDS,
  createAppDialogsHarness,
  dialogFor,
  draft,
  type HarnessDialogId,
} from "./support/appDialogsHarness";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string; resolved: string }; samples: Array<Record<string, unknown>> };
const replace = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;
const req = (id: string, title: string) => ({ ...replace, requestId: id, documentTitle: title });

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

const makeHarness = () => createAppDialogsHarness({ deliver, events: fx.events, request: req });
const dialog = (id: HarnessDialogId) => screen.getByRole("dialog", { name: DIALOG_NAME[id] });
const controlIds = (event: string) =>
  logs.filter((p) => p.event === event).map((p) => p.context?.controlId);

beforeEach(() => {
  bus.window.clear();
  core.calls.length = 0;
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("AppDialogs (D42 WI-3)", () => {
  it.each(HARNESS_DIALOG_IDS)("3.1: the %s slot renders its dialog iff its input says open", async (id) => {
    const h = makeHarness();
    render(<h.Harness />);
    await settle();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);

    await h.open(id);
    await settle();
    const shown = screen.queryAllByRole("dialog");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toBe(dialog(id));

    await h.close(id);
    await settle();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  });

  it("3.1: Recovery shows with one draft and is absent with []", async () => {
    const h = makeHarness();
    render(<h.Harness initial={{ drafts: [draft("d1")] }} />);
    expect(dialogFor("recovery")).not.toBeNull();
    act(() => h.set({ drafts: [] }));
    expect(dialogFor("recovery")).toBeNull();
  });

  it("3.2: each content prop reaches its own dialog", async () => {
    const h = makeHarness();
    render(<h.Harness />);
    await settle();

    act(() => h.set({ reloadMessage: "alpha.md changed on disk" }));
    expect(within(dialog("reload")).getByText("alpha.md changed on disk")).toBeInTheDocument();
    act(() => h.set({ reloadMessage: "beta.md was deleted" }));
    expect(within(dialog("reload")).getByText("beta.md was deleted")).toBeInTheDocument();
    expect(within(dialog("reload")).queryByText("alpha.md changed on disk")).toBeNull();

    act(() => h.set({ encodingIssue: { path: "/x/gb.md", detected: "GBK" } }));
    expect(within(dialog("encoding")).getByText("/x/gb.md")).toBeInTheDocument();
    // D52: the user-approved body names no detected encoding (「去掉 detected」).
    expect(
      within(dialog("encoding")).getByText(
        "This file isn't valid UTF-8. Files in legacy encodings such as GBK, Big5 or Shift-JIS can't be opened yet.",
      ),
    ).toBeInTheDocument();
    expect(dialog("encoding").textContent ?? "").not.toMatch(/detected/i);

    act(() => h.set({ pendingClose: "document" }));
    expect(within(dialog("confirm")).getByText(CLOSE_DIALOG_MESSAGE)).toBeInTheDocument();
    act(() => h.set({ quitPrompt: { requestId: 1 } }));
    expect(within(dialog("confirm")).getByText(QUIT_DIALOG_MESSAGE)).toBeInTheDocument();
    expect(within(dialog("confirm")).queryByText(CLOSE_DIALOG_MESSAGE)).toBeNull();

    act(() => h.set({ drafts: [draft("d1", "One"), draft("d2", "Two")] }));
    expect(within(dialog("recovery")).getByText("One")).toBeInTheDocument();
    expect(within(dialog("recovery")).getByText("Two")).toBeInTheDocument();
  });

  type Row = {
    name: string;
    id: HarnessDialogId;
    initial: Parameters<ReturnType<typeof makeHarness>["Harness"]>[0]["initial"];
    click: (el: HTMLElement) => HTMLElement;
    call: { handler: string; arg?: string };
    log: { event: string; controlId: string };
  };
  const rows: Row[] = [
    {
      name: "Unsaved 'Keep editing'",
      id: "confirm",
      initial: { pendingClose: "document" },
      click: (el) => within(el).getByRole("button", { name: "Keep editing" }),
      call: { handler: "cancelClose" },
      log: { event: "ui.dialog.cancel", controlId: "dialog.confirm.cancel" },
    },
    {
      name: "Unsaved 'Discard changes'",
      id: "confirm",
      initial: { pendingClose: "document" },
      click: (el) => within(el).getByRole("button", { name: "Discard changes" }),
      call: { handler: "confirmClose" },
      log: { event: "ui.dialog.confirm", controlId: "dialog.confirm.confirm" },
    },
    {
      name: "Reload 'Ignore'",
      id: "reload",
      initial: { reloadMessage: "notes.md changed on disk" },
      click: (el) => within(el).getByRole("button", { name: "Ignore" }),
      call: { handler: "ignoreReload" },
      log: { event: "ui.dialog.cancel", controlId: "dialog.reload.ignore" },
    },
    {
      name: "Reload 'Reload'",
      id: "reload",
      initial: { reloadMessage: "notes.md changed on disk" },
      click: (el) => within(el).getByRole("button", { name: "Reload" }),
      call: { handler: "reloadFile" },
      log: { event: "ui.dialog.confirm", controlId: "dialog.reload.reload" },
    },
    {
      name: "Recovery 'Recover' on d1",
      id: "recovery",
      initial: { drafts: [draft("d1", "One")] },
      click: (el) => within(el).getByRole("button", { name: "Recover" }),
      call: { handler: "recoverDraft", arg: "d1" },
      log: { event: "ui.dialog.confirm", controlId: "dialog.recovery.recover" },
    },
    {
      name: "Encoding 'UTF-16LE'",
      id: "encoding",
      initial: { encodingIssue: { path: "/x/gb.md", detected: "GBK" } },
      click: (el) => within(el).getByRole("button", { name: "UTF-16LE" }),
      call: { handler: "encodingSelect", arg: "UTF-16LE" },
      log: { event: "ui.dialog.confirm", controlId: "dialog.encoding.select" },
    },
    {
      name: "Encoding 'Cancel'",
      id: "encoding",
      initial: { encodingIssue: { path: "/x/gb.md", detected: "GBK" } },
      click: (el) => within(el).getByRole("button", { name: "Cancel" }),
      call: { handler: "encodingCancel" },
      log: { event: "ui.dialog.cancel", controlId: "dialog.encoding.cancel" },
    },
    {
      // D260 (A1): the footer "Close" is gone; the header × is the dialog's
      // close control, with the same handler and the same log.
      name: "Settings '×'",
      id: "settings",
      initial: { settingsOpen: true },
      click: (el) => within(el).getByRole("button", { name: "×" }),
      call: { handler: "settingsClose" },
      log: { event: "ui.button.click", controlId: "settings.close" },
    },
  ];

  it.each(rows)("3.3: $name routes to its own handler and the dialog closes", async (row) => {
    const user = userEvent.setup();
    const h = makeHarness();
    render(<h.Harness initial={row.initial} />);
    await settle();

    await user.click(row.click(dialog(row.id)));
    await settle();

    expect(h.calls).toStrictEqual([row.call]);
    expect(dialogFor(row.id)).toBeNull();
    expect(controlIds(row.log.event)).toContain(row.log.controlId);
  });

  it("3.3: Recovery 'Discard' on the second draft drops only that draft", async () => {
    const user = userEvent.setup();
    const h = makeHarness();
    render(<h.Harness initial={{ drafts: [draft("d1", "One"), draft("d2", "Two")] }} />);
    await settle();

    const discards = within(dialog("recovery")).getAllByRole("button", { name: "Discard" });
    expect(discards).toHaveLength(2);
    await user.click(discards[1]);
    await settle();

    expect(h.calls.at(-1)).toStrictEqual({ handler: "discardDraft", arg: "d2" });
    expect(within(dialog("recovery")).getByText("One")).toBeInTheDocument();
    expect(within(dialog("recovery")).queryByText("Two")).toBeNull();
    expect(controlIds("ui.dialog.cancel")).toContain("dialog.recovery.discard");
  });

  it("3.4: the MCP subscription exists while every dialog is closed", async () => {
    const h = makeHarness();
    render(<h.Harness />);
    await settle();

    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    expect(bus.window.get(fx.events.request)?.size).toBe(1);
    expect(bus.window.get(fx.events.resolved)?.size).toBe(1);

    await deliver(fx.events.request, req("r1", "Alpha"));
    expect(dialog("mcp")).toBeInTheDocument();
  });
});
