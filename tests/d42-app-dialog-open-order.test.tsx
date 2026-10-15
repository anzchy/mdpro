/**
 * D42 WI-4 — App-level dialogs render in the order they were opened.
 *
 * Specification: `.claude/tdd-guardian/tests-20261008-131500.md` § WI-4, cases 4.1 … 4.16,
 * 4.19 and 4.20; 4.8 (i)(ii), 4.10 pairs and 4.11 pairs run here. The triples of 4.10, the
 * 4.17 random walk and 4.8 (iii) are in `d42-app-dialog-open-order.slow.test.tsx` (ADR-0050).
 * 4.18 is the regression net (the other suites, run unmodified).
 *
 * Law:
 * (a) the document order of the open `role="dialog"` elements equals the oracle's open order
 *     after every transition;
 * (b) an open dialog is never detached and reinserted, except by an MCP `requestId` change;
 * (c) an Escape with focus inside the top dialog affects only the top dialog;
 * (d) `ui.dialog.stack` lines are exactly the order changes with two or more open, ids only.
 * Expected orders come from literals or from `tests/support/dialogOpenOrderOracle.ts`, never
 * from `src/utils/dialogOpenOrder.ts`.
 *
 * D240 (ADR-0108, partially superseding ADR-0062 decision 1): an MCP prompt that arrives, or
 * replaces the shown one, while another dialog is open is held: it is not rendered and not in
 * the order until the last other dialog closes, then it shows with Reject focused. Cases 4.4,
 * 4.5, 4.8 (i), 4.9, 4.10, 4.11, 4.14, 4.16 and 4.20 (a) were rewritten to that behaviour; the
 * expected orders apply the hold through `heldApply` in `tests/support/d42DialogDriver.ts`.
 *
 * Mock boundaries (MB-T): `@tauri-apps/api/webviewWindow` (a fake bus) and
 * `@tauri-apps/api/core` `invoke`, routed: `log_event` → `logs`, `mcp_confirm_reply` →
 * recorded, the SettingsDialog loads → fixtures. `loggingService` / `loggingStore`, every
 * dialog, `useDialogEscape` and `useMcpConfirm` are real.
 * Paired real paths (PAIR-T): `services/mcp_confirm/payload_tests.rs::p1_event_names_match_the_contract`,
 * `::p2_resolved_payload_covers_every_wire_outcome`, `http_tests.rs::h3_each_real_outcome_through_the_gate_yields_its_status`,
 * `commands/mcp_confirm_tests.rs::r6_reply_lines_through_the_core_never_carry_the_title`,
 * `services/logger.rs` `mod tests`, and device checks G-D42-1/2/3 (WI-5). jsdom does not
 * reproduce paint order or WKWebView's focus fix-up; those are device-only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
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
import { QUIT_DIALOG_MESSAGE } from "../src/utils/quitDialogModel";
import {
  DIALOG_NAME,
  HARNESS_DIALOG_IDS,
  createAppDialogsHarness,
  dialogFor,
  domDialogOrder,
  type AppDialogsHarness,
  type HarnessDialogId,
} from "./support/appDialogsHarness";
import {
  applyDomainEvent,
  offendingRemovals,
  removedDialogIds,
  stackProjection,
  watchRemovals,
  type DriverStep,
} from "./support/d42DialogDriver";
import type { OracleDialogId } from "./support/dialogOpenOrderOracle";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string; resolved: string }; samples: Array<Record<string, unknown>> };
const replace = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;
const req = (id: string, title: string) => ({ ...replace, requestId: id, documentTitle: title });
const replies = () => core.calls.filter((c) => c.cmd === "mcp_confirm_reply");
const rejected = (id: string) => ({ cmd: "mcp_confirm_reply", args: { requestId: id, approved: false } });
const escapeLines = () => logs.filter((p) => p.event === "ui.dialog.escape");
const stackLines = () => logs.filter((p) => p.event === "ui.dialog.stack");
const stackContexts = () => stackLines().map((p) => p.context);

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

function blurToBody() {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(document.activeElement).toBe(document.body);
}

function escapeOn(target: EventTarget) {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  let ok = true;
  act(() => {
    ok = target.dispatchEvent(ev);
  });
  return { ev, ok };
}

/** Past SettingsDialog's 50 ms deferred first-nav focus (`SettingsDialog.tsx` L95). */
async function waitPastSettingsTimer(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

const makeHarness = (request: (id: string, title: string) => unknown = req) =>
  createAppDialogsHarness({ deliver, events: fx.events, request });

async function mount(h: AppDialogsHarness, strict = false) {
  const view = render(strict ? <StrictMode><h.Harness /></StrictMode> : <h.Harness />);
  await settle();
  return view;
}

const dialog = (id: HarnessDialogId) => screen.getByRole("dialog", { name: DIALOG_NAME[id] });
const follows = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const handlerCount = (h: AppDialogsHarness, handler: string) =>
  h.calls.filter((c) => c.handler === handler).length;

beforeEach(() => {
  bus.window.clear();
  core.calls.length = 0;
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("D42: App-level dialogs render in open order", () => {
  it("4.1 RED (D42): Unsaved, then Reload → Reload is on top and takes Escape", async () => {
    const user = userEvent.setup();
    const h = makeHarness();
    await mount(h);
    await h.open("confirm");
    await h.open("reload");
    await settle();
    expect(screen.getByRole("button", { name: "Reload" })).toHaveFocus();
    expect.soft(domDialogOrder()).toEqual(["confirm", "reload"]);
    expect.soft(follows(dialog("confirm"), dialog("reload"))).toBe(true);

    await user.keyboard("{Escape}");
    await settle();
    expect(dialogFor("reload")).toBeNull();
    expect(dialogFor("confirm")).not.toBeNull();
    expect(h.calls).toContainEqual({ handler: "ignoreReload" });
    expect(handlerCount(h, "cancelClose")).toBe(0);
    expect(
      logs.filter((p) => p.event === "ui.dialog.cancel").map((p) => p.context?.controlId),
    ).toContain("dialog.reload.ignore");
    // D140 (changed assertion with a stated reason): ReloadDialog is now on the
    // `useDialogEscape` stack, so its Escape also logs `ui.dialog.escape`.
    expect(escapeLines().map((p) => p.context)).toStrictEqual([{ dialog: "reload", outcome: "ignore" }]);

    act(() => screen.getByRole("button", { name: "Keep editing" }).focus());
    await user.keyboard("{Escape}");
    await settle();
    expect(dialogFor("confirm")).toBeNull();
    expect(handlerCount(h, "cancelClose")).toBe(1);
    expect(escapeLines().map((p) => p.context)).toStrictEqual([
      { dialog: "reload", outcome: "ignore" },
      { dialog: "confirm", outcome: "cancel" },
    ]);
  });

  it("4.2 reverse order: Reload, then Unsaved → Unsaved is on top", async () => {
    const user = userEvent.setup();
    const h = makeHarness();
    await mount(h);
    await h.open("reload");
    await h.open("confirm");
    await settle();
    expect(domDialogOrder()).toEqual(["reload", "confirm"]);
    // The dialog opened last takes focus. Since D48 (`destructive`) its autoFocus is
    // Keep editing, not Discard changes.
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await settle();
    expect(dialogFor("confirm")).toBeNull();
    expect(dialogFor("reload")).not.toBeNull();
    expect(handlerCount(h, "cancelClose")).toBe(1);
    expect(handlerCount(h, "ignoreReload")).toBe(0);
    expect(escapeLines().map((p) => p.context)).toStrictEqual([{ dialog: "confirm", outcome: "cancel" }]);
  });

  it("4.3 close and reopen appends after every still-open dialog", async () => {
    const h = makeHarness();
    await mount(h);
    const seen: HarnessDialogId[][] = [];
    await h.open("confirm");
    seen.push(domDialogOrder());
    await h.open("reload");
    seen.push(domDialogOrder());
    await h.close("confirm");
    seen.push(domDialogOrder());
    await h.open("confirm");
    seen.push(domDialogOrder());
    expect(seen).toEqual([["confirm"], ["confirm", "reload"], ["reload"], ["reload", "confirm"]]);
  });

  it.each(["confirm-then-mcp", "mcp-then-confirm"] as const)(
    "4.4 MCP and Unsaved, %s: MCP opened first is covered; MCP arriving later waits (ADR-0108)",
    async (order) => {
      const user = userEvent.setup();
      const h = makeHarness();
      await mount(h);
      if (order === "confirm-then-mcp") {
        await h.open("confirm");
        await h.open("mcp");
      } else {
        await h.open("mcp");
        await h.open("confirm");
      }
      await settle();
      blurToBody();

      if (order === "confirm-then-mcp") {
        // ADR-0108: the arriving prompt is held while Unsaved is open.
        expect(domDialogOrder()).toEqual(["confirm"]);
        expect(dialogFor("mcp")).toBeNull();
        await user.keyboard("{Escape}");
        await settle();
        expect(handlerCount(h, "cancelClose")).toBe(1);
        expect(dialogFor("confirm")).toBeNull();
        expect(replies()).toStrictEqual([]);
        expect(domDialogOrder()).toEqual(["mcp"]);
        expect(within(dialog("mcp")).getByRole("button", { name: "Reject" })).toHaveFocus();
        await user.keyboard("{Escape}");
        await settle();
        expect(replies()).toStrictEqual([rejected("r1")]);
        expect(dialogFor("mcp")).toBeNull();
        expect(escapeLines().map((p) => p.context)).toStrictEqual([
          { dialog: "confirm", outcome: "cancel" },
          { dialog: "mcp_write_confirm", outcome: "reject" },
        ]);
      } else {
        expect(domDialogOrder()).toEqual(["mcp", "confirm"]);
        await user.keyboard("{Escape}");
        await settle();
        expect(handlerCount(h, "cancelClose")).toBe(1);
        expect(dialogFor("confirm")).toBeNull();
        expect(dialogFor("mcp")).not.toBeNull();
        expect(replies()).toStrictEqual([]);
        await user.keyboard("{Escape}");
        await settle();
        expect(replies()).toStrictEqual([rejected("r1")]);
        expect(dialogFor("mcp")).toBeNull();
        expect(escapeLines().map((p) => p.context)).toStrictEqual([
          { dialog: "confirm", outcome: "cancel" },
          { dialog: "mcp_write_confirm", outcome: "reject" },
        ]);
      }
    },
  );

  it.each(["queued", "close-then-new"] as const)(
    "4.5 (%s) an MCP token change under Reload holds r2 (ADR-0108); it shows, Reject focused, when Reload closes",
    async (shape) => {
      const h = makeHarness();
      await mount(h);
      await h.open("mcp");
      await h.open("reload");
      await settle();
      expect(domDialogOrder()).toEqual(["mcp", "reload"]);

      const watcher = watchRemovals(document.body);
      if (shape === "queued") {
        await h.reopen("mcp");
      } else {
        await h.close("mcp");
        await settle();
        await h.open("mcp");
      }
      await settle();
      const records = watcher.drain();
      watcher.stop();

      expect(domDialogOrder()).toEqual(["reload"]);
      expect(dialogFor("mcp")).toBeNull();
      expect(replies()).toStrictEqual([]);
      expect(removedDialogIds(records)).toContain("mcp");
      expect(offendingRemovals(records, ["reload"], false)).toEqual([]);

      await h.close("reload");
      await settle();
      expect(domDialogOrder()).toEqual(["mcp"]);
      expect(within(dialog("mcp")).getByText(/Doc r2/)).toBeInTheDocument();
      expect(within(dialog("mcp")).getByRole("button", { name: "Reject" })).toHaveFocus();
      expect(replies()).toStrictEqual([]);
      expect(stackContexts()).toStrictEqual([{ order: ["mcp", "reload"] }]);
    },
  );

  it("4.6 (a) a Reload message change does not re-raise it", async () => {
    const h = makeHarness();
    await mount(h);
    act(() => h.set({ reloadMessage: "a.md changed on disk" }));
    await h.open("confirm");
    await settle();
    const reloadCard = dialog("reload");
    const confirmCard = dialog("confirm");
    const k = stackLines().length;

    act(() => h.set({ reloadMessage: "a.md was deleted" }));
    await settle();
    expect(domDialogOrder()).toEqual(["reload", "confirm"]);
    expect(within(dialog("reload")).getByText("a.md was deleted")).toBeInTheDocument();
    expect(dialog("reload")).toBe(reloadCard);
    expect(dialog("confirm")).toBe(confirmCard);
    expect(stackLines()).toHaveLength(k);
  });

  it("4.6 (b) the quit takeover does not re-raise Unsaved", async () => {
    const h = makeHarness();
    await mount(h);
    await h.open("confirm");
    await h.open("reload");
    await settle();
    const reloadCard = dialog("reload");
    const confirmCard = dialog("confirm");
    const k = stackLines().length;

    act(() => h.set({ quitPrompt: { requestId: 1 } }));
    await settle();
    expect(domDialogOrder()).toEqual(["confirm", "reload"]);
    expect(within(dialog("confirm")).getByText(QUIT_DIALOG_MESSAGE)).toBeInTheDocument();
    expect(dialog("reload")).toBe(reloadCard);
    expect(dialog("confirm")).toBe(confirmCard);
    expect(stackLines()).toHaveLength(k);
  });

  it("4.7 no remount: the focused Unsaved dialog keeps its node and its focus", async () => {
    const h = makeHarness();
    await mount(h);
    await h.open("confirm");
    const card = dialog("confirm");
    act(() => screen.getByRole("button", { name: "Keep editing" }).focus());

    const steps: Array<[() => Promise<void>, boolean]> = [
      [() => h.open("recovery"), true],
      [() => h.close("recovery"), true],
      // D52 / ADR-0057 decision 1: the encoding dialog takes initial focus (Cancel),
      // like MCP's Reject, so from here on focus is not held; the node still is.
      [() => h.open("encoding"), false],
      [() => h.close("encoding"), false],
      [() => h.open("mcp"), false],
      [() => h.close("mcp"), false],
    ];
    for (const [step, focusHeld] of steps) {
      await step();
      await settle();
      expect(dialog("confirm")).toBe(card);
      expect(card.isConnected).toBe(true);
      if (focusHeld) expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    }
    expect(handlerCount(h, "cancelClose")).toBe(0);
    expect(handlerCount(h, "confirmClose")).toBe(0);
  });

  it("4.8 (i) an MCP prompt held under Unsaved moves no open dialog (ADR-0108), and shows once it closes", async () => {
    const h = makeHarness();
    await mount(h);
    await h.open("confirm");
    await settle();
    const watcher = watchRemovals(document.body);
    await h.open("mcp");
    await settle();
    const records = watcher.drain();
    watcher.stop();
    expect(domDialogOrder()).toEqual(["confirm"]);
    expect(dialogFor("mcp")).toBeNull();
    expect(removedDialogIds(records)).toEqual([]);
    await h.close("confirm");
    await settle();
    expect(domDialogOrder()).toEqual(["mcp"]);
  });

  it("4.9 SettingsDialog keeps its state, and the MCP subscription survives every reorder", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const user = userEvent.setup();
    const h = makeHarness();
    await mount(h);
    await h.open("mcp");
    await h.open("settings");
    await waitPastSettingsTimer();
    await settle();
    const settingsCard = dialog("settings");
    await user.click(within(settingsCard).getByRole("button", { name: "Editor" }));
    await settle();
    const n0 = core.calls.filter((c) => c.cmd === "get_preferences").length;

    const holds = () => {
      expect(dialog("settings")).toBe(settingsCard);
      expect(within(settingsCard).getByRole("heading", { name: "Editor" })).toBeInTheDocument();
      expect(within(settingsCard).queryByRole("heading", { name: "General" })).toBeNull();
      expect(core.calls.filter((c) => c.cmd === "get_preferences")).toHaveLength(n0);
      expect(bus.window.get(fx.events.request)?.size).toBe(1);
    };
    holds();
    for (const step of [
      () => h.open("reload"),
      () => h.close("reload"),
      () => h.reopen("mcp"),
      () => h.open("confirm"),
      () => h.close("confirm"),
    ]) {
      await step();
      await settle();
      holds();
    }
    // ADR-0108: r2 replaced r1 while Settings was open, so it is held.
    expect(dialogFor("mcp")).toBeNull();
    expect(domDialogOrder()).toEqual(["settings"]);
    await h.close("settings");
    await settle();
    expect(within(dialog("mcp")).getByText(/Doc r2/)).toBeInTheDocument();
    expect(within(dialog("mcp")).getByRole("button", { name: "Reject" })).toHaveFocus();
  });

  it("4.12 Recovery under Unsaved: Escape cancels Unsaved and Recovery stays", async () => {
    const user = userEvent.setup();
    const h = makeHarness();
    await mount(h);
    await h.open("recovery");
    await h.open("confirm");
    await settle();
    blurToBody();
    await user.keyboard("{Escape}");
    await settle();
    expect(dialogFor("confirm")).toBeNull();
    expect(handlerCount(h, "cancelClose")).toBe(1);

    await user.keyboard("{Escape}");
    await settle();
    expect(dialogFor("recovery")).not.toBeNull();
    expect(h.calls.filter((c) => /Draft$/.test(c.handler))).toEqual([]);
    expect(escapeOn(document.body).ok).toBe(true);
    expect(dialogFor("recovery")).not.toBeNull();
    expect(escapeLines().map((p) => p.context)).toStrictEqual([{ dialog: "confirm", outcome: "cancel" }]);
  });

  // D140 (changed assertion with a stated reason): this case pinned ADR-0045 Cost e — focus on
  // <body> under Reload, Escape did nothing — as a known cost "until ReloadDialog is registered
  // on `useDialogEscape`". D140 registers it, so the cost is gone: Escape from <body> takes the
  // top dialog (Reload) and leaves the covered one open.
  it("4.13 (D140): focus on <body> under Reload → Escape ignores Reload only", async () => {
    const h = makeHarness();
    await mount(h);
    await h.open("confirm");
    await h.open("reload");
    await settle();
    blurToBody();
    const before = h.calls.length;
    const { ev, ok } = escapeOn(document.body);
    await settle();
    expect(ok).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
    expect(dialogFor("confirm")).not.toBeNull();
    expect(dialogFor("reload")).toBeNull();
    expect(h.calls.slice(before)).toEqual([{ handler: "ignoreReload" }]);
    expect(escapeLines().map((p) => p.context)).toStrictEqual([{ dialog: "reload", outcome: "ignore" }]);
  });

  it("4.14 ui.dialog.stack is the exact projection of order changes with ≥ 2 open, ids only", async () => {
    const secretReq = (id: string) => ({
      ...replace,
      requestId: id,
      documentTitle: "TOP-SECRET-ROADMAP.md",
      documentId: "DOCID-zq81",
    });
    const h = makeHarness(secretReq);
    await mount(h);
    // ADR-0108: MCP opens first; a prompt arriving under Reload would be held, not stacked.
    await h.open("mcp");
    act(() => h.set({ reloadMessage: "TOP-SECRET-ROADMAP.md changed" }));
    await h.open("confirm");
    act(() => h.set({ encodingIssue: { path: "/Users/x/TOP-SECRET-ROADMAP.md", detected: "GBK" } }));
    await h.close("reload");
    await h.close("confirm");
    await h.close("encoding");
    await h.close("mcp");
    await settle();

    expect(stackContexts()).toStrictEqual([
      { order: ["mcp", "reload"] },
      { order: ["mcp", "reload", "confirm"] },
      { order: ["mcp", "reload", "confirm", "encoding"] },
      { order: ["mcp", "confirm", "encoding"] },
      { order: ["mcp", "encoding"] },
    ]);
    for (const line of stackLines()) {
      expect(Object.keys(line.context ?? {})).toEqual(["order"]);
      for (const id of line.context?.order as string[]) {
        expect(HARNESS_DIALOG_IDS).toContain(id);
      }
      expect(JSON.stringify(line)).not.toContain("TOP-SECRET-ROADMAP");
      expect(JSON.stringify(line)).not.toContain("DOCID-zq81");
    }
  });

  it("4.15 an unchanged re-render does not loop, log or move", async () => {
    const h = makeHarness();
    await mount(h);
    await h.open("confirm");
    await h.open("reload");
    await settle();
    const confirmCard = dialog("confirm");
    const reloadCard = dialog("reload");
    const order = domDialogOrder();
    const k = stackLines().length;

    for (let i = 0; i < 5; i += 1) act(() => h.set({}));
    act(() => h.set({ reloadMessage: "notes.md changed on disk" }));
    await settle();
    expect(stackLines()).toHaveLength(k);
    expect(domDialogOrder()).toEqual(order);
    expect(dialog("confirm")).toBe(confirmCard);
    expect(dialog("reload")).toBe(reloadCard);
  });

  it("4.16 StrictMode gives the same order and the same log lines", async () => {
    async function run(strict: boolean) {
      bus.window.clear();
      logs.length = 0;
      const h = makeHarness();
      const view = await mount(h, strict);
      const orders: HarnessDialogId[][] = [];
      for (const step of [
        () => h.open("confirm"),
        () => h.open("reload"),
        () => h.close("reload"),
        () => h.close("confirm"),
        // ADR-0108: MCP first, then Unsaved over it; then a prompt held under Unsaved.
        () => h.open("mcp"),
        () => h.open("confirm"),
        () => h.close("mcp"),
        () => h.open("mcp"),
        () => h.close("confirm"),
      ]) {
        await step();
        await settle();
        orders.push(domDialogOrder());
      }
      const stacks = stackContexts();
      view.unmount();
      await settle();
      return { orders, stacks };
    }
    const plain = await run(false);
    const strict = await run(true);
    expect(plain.orders).toEqual([
      ["confirm"],
      ["confirm", "reload"],
      ["confirm"],
      [],
      ["mcp"],
      ["mcp", "confirm"],
      ["confirm"],
      ["confirm"],
      ["mcp"],
    ]);
    expect(plain.stacks).toStrictEqual([{ order: ["confirm", "reload"] }, { order: ["mcp", "confirm"] }]);
    expect(strict.orders).toEqual(plain.orders);
    expect(strict.stacks).toStrictEqual(plain.stacks);
  });

  it("4.19 a non-MCP reopen that reuses its constant token is not lost behind the closed slots", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const h = makeHarness();
    await mount(h);
    const seen: HarnessDialogId[][] = [];
    for (const step of [
      () => h.open("settings"),
      () => h.close("settings"),
      () => h.open("settings"),
      () => h.open("reload"),
    ]) {
      await step();
      await settle();
      seen.push(domDialogOrder());
    }
    expect(seen).toEqual([["settings"], [], ["settings"], ["settings", "reload"]]);
    expect(follows(dialog("settings"), dialog("reload"))).toBe(true);
    expect(stackContexts()).toStrictEqual([{ order: ["settings", "reload"] }]);
  });

  it("4.20 (a) an MCP token change under other dialogs holds r2 and logs the shorter order (ADR-0108)", async () => {
    const h = makeHarness();
    await mount(h);
    await h.open("mcp");
    await h.open("reload");
    await h.open("confirm");
    await h.reopen("mcp");
    await settle();
    expect(stackContexts()).toStrictEqual([
      { order: ["mcp", "reload"] },
      { order: ["mcp", "reload", "confirm"] },
      { order: ["reload", "confirm"] },
    ]);
    expect(domDialogOrder()).toEqual(["reload", "confirm"]);
    expect(dialogFor("mcp")).toBeNull();
    await h.close("reload");
    await h.close("confirm");
    await settle();
    expect(domDialogOrder()).toEqual(["mcp"]);
    expect(within(dialog("mcp")).getByText(/Doc r2/)).toBeInTheDocument();
  });

  it("4.20 (b) a same-commit swap that keeps the open count is logged, in one commit", async () => {
    const h = makeHarness();
    await mount(h);
    expect(h.counters.commits).toBeGreaterThan(0);
    // The Profiler counter counts commits under vitest: one plain update is one commit.
    const p0 = h.counters.commits;
    act(() => h.set({}));
    expect(h.counters.commits - p0).toBe(1);

    await h.open("reload");
    await h.open("encoding");
    await settle();
    const c0 = h.counters.commits;
    act(() => {
      h.set(h.closePatch("reload"));
      h.set(h.openPatch("confirm"));
    });
    expect(h.counters.commits - c0).toBe(1);
    await settle();
    expect(stackContexts()).toStrictEqual([
      { order: ["reload", "encoding"] },
      { order: ["encoding", "confirm"] },
    ]);
    expect(domDialogOrder()).toEqual(["encoding", "confirm"]);
  });
});

const PAIRS: Array<[HarnessDialogId, HarnessDialogId]> = HARNESS_DIALOG_IDS.flatMap((x) =>
  HARNESS_DIALOG_IDS.filter((y) => y !== x).map((y) => [x, y] as [HarnessDialogId, HarnessDialogId]),
);

describe("D42: exhaustive pairs", () => {
  it.each(PAIRS)(
    "4.10 / 4.8 (ii) / 4.14: open %s then %s — DOM order is the oracle, nothing open moves, stack lines project",
    async (x, y) => {
      if (x === "settings" || y === "settings") vi.mocked(isTauri).mockReturnValue(true);
      const h = makeHarness();
      await mount(h);
      const watcher = watchRemovals(document.body);
      let order: OracleDialogId[] = [];
      let k = stackLines().length;
      const check = async ({ oracle, before, mcpTokenChanged }: DriverStep) => {
        await settle();
        expect(domDialogOrder()).toEqual(oracle);
        expect(offendingRemovals(watcher.drain(), oracle, mcpTokenChanged)).toEqual([]);
        expect(stackContexts().slice(k)).toStrictEqual(stackProjection(before, oracle));
        k = stackLines().length;
      };
      order = await applyDomainEvent(h, order, { kind: "open", id: x }, check);
      order = await applyDomainEvent(h, order, { kind: "open", id: y }, check);
      if (y === "mcp") {
        // ADR-0108: MCP arriving under X is held; it is on screen once X closes.
        expect(order).toEqual([x]);
        expect(dialogFor("mcp")).toBeNull();
        order = await applyDomainEvent(h, order, { kind: "close", id: x }, check);
        watcher.stop();
        expect(order).toEqual(["mcp"]);
        return;
      }
      watcher.stop();
      expect(order).toEqual([x, y]);
    },
  );

  const FOCUS_IN: Record<HarnessDialogId, string> = {
    reload: "Ignore",
    confirm: "Keep editing",
    settings: "General",
    mcp: "Reject",
    encoding: "Cancel",
    recovery: "Recover",
  };
  const EFFECT: Partial<Record<HarnessDialogId, string>> = {
    reload: "ignoreReload",
    confirm: "cancelClose",
    settings: "settingsClose",
    // D52 / ADR-0057 decision 1: Escape on the encoding dialog takes Cancel.
    encoding: "encodingCancel",
  };

  const ON_STACK: ReadonlySet<HarnessDialogId> = new Set(["confirm", "mcp", "reload", "encoding"]);

  it.each(PAIRS)("4.11: open %s then %s, focus in the top one — Escape affects only the top", async (x, y) => {
    if (x === "settings" || y === "settings") vi.mocked(isTauri).mockReturnValue(true);
    const user = userEvent.setup();
    const h = makeHarness();
    await mount(h);
    await h.open(x);
    await h.open(y);
    await settle();
    if (x === "settings" || y === "settings") await waitPastSettingsTimer();
    if (y === "mcp") {
      // ADR-0108: the prompt is held under X, so X is the top dialog and Escape is X's.
      expect(dialogFor("mcp")).toBeNull();
      const inX = within(dialog(x)).getByRole("button", { name: FOCUS_IN[x] });
      act(() => inX.focus());
      const calls0 = [...h.calls];
      const esc0 = escapeLines().length;
      await user.keyboard("{Escape}");
      await settle();
      expect(replies()).toStrictEqual([]);
      if (x === "recovery") {
        expect(dialogFor("recovery")).not.toBeNull();
        expect(dialogFor("mcp")).toBeNull();
        expect(h.calls).toEqual(calls0);
      } else {
        const effect = EFFECT[x];
        expect(h.calls.slice(calls0.length)).toEqual(effect ? [{ handler: effect }] : []);
        expect(dialogFor(x)).toBeNull();
        expect(within(dialog("mcp")).getByRole("button", { name: "Reject" })).toHaveFocus();
      }
      expect(escapeLines().length - esc0).toBe(ON_STACK.has(x) ? 1 : 0);
      return;
    }
    const target = within(dialog(y)).getByRole("button", { name: FOCUS_IN[y] });
    act(() => target.focus());
    expect(target).toHaveFocus();
    const calls0 = [...h.calls];
    const replies0 = replies().length;
    const esc0 = escapeLines().length;

    await user.keyboard("{Escape}");
    await settle();
    expect(dialogFor(x)).not.toBeNull();
    if (y === "recovery") {
      expect(dialogFor(y)).not.toBeNull();
      expect(h.calls).toEqual(calls0);
      expect(replies()).toHaveLength(replies0);
    } else {
      expect(dialogFor(y)).toBeNull();
      const effect = EFFECT[y];
      expect(h.calls.slice(calls0.length)).toEqual(effect ? [{ handler: effect }] : []);
      expect(replies().slice(replies0)).toStrictEqual([]);
    }
    // D140: Reload and Encoding joined the `useDialogEscape` stack, so they log `ui.dialog.escape` too.
    expect(escapeLines().length - esc0).toBe(ON_STACK.has(y) ? 1 : 0);
  });
});
