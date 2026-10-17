/**
 * D241-WI-2 — startup Recovery waits while another modal or a received MCP
 * request is pending (ADR-0116 Decisions 1, 3 and 4), through `AppDialogs`.
 *
 * Laws:
 * 1. Recovery and an MCP prompt are never both mounted before Recovery's
 *    first admission, and the MCP prompt wins every tie.
 * 2. Recovery is admitted only on a fresh `list_drafts`, checked against the
 *    document and the MCP-pending ref when that list returns.
 * 3. Admission is once per window; "holds the slot" ends with the last row,
 *    and an MCP request is then shown at once.
 *
 * Mock boundaries: webviewWindow `listen` (a fake bus) and core `invoke`,
 * routed: `log_event` → `logs`, `list_drafts` → a controllable list,
 * `mcp_confirm_reply` → recorded. The real AppDialogs, hooks and dialogs run,
 * driven by the shared `appDialogsHarness`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Cb = (event: { payload: unknown }) => void;
type LogPayload = { event?: string; context?: Record<string, unknown>; [key: string]: unknown };

const { bus, core, logs, list } = vi.hoisted(() => ({
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  core: { calls: [] as Array<{ cmd: string; args: Record<string, unknown> }> },
  logs: [] as Array<{ event?: string; context?: Record<string, unknown>; [key: string]: unknown }>,
  list: {
    manual: { value: false },
    result: { value: null as unknown },
    fail: { value: false },
    pending: [] as Array<() => void>,
  },
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
    if (cmd === "list_drafts") {
      const answer = () => {
        if (list.fail.value) throw new Error("list failed");
        return list.result.value;
      };
      if (!list.manual.value) return answer();
      return new Promise((ok, fail) => {
        list.pending.push(() => {
          try {
            ok(answer());
          } catch (error) {
            fail(error);
          }
        });
      });
    }
    if (cmd === "mcp_confirm_reply") return "resolved";
    return null;
  },
}));

import { useLoggingStore } from "../src/stores/loggingStore";
import { createAppDialogsHarness, dialogFor, draft } from "./support/appDialogsHarness";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string; resolved: string }; samples: Array<Record<string, unknown>> };
const replace = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;
const req = (id: string, title: string) => ({ ...replace, requestId: id, documentTitle: title });

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.window.get(name) ?? [])]) cb({ payload });
    await Promise.resolve();
  });
}

function fire(name: string, payload: unknown): void {
  for (const cb of [...(bus.window.get(name) ?? [])]) cb({ payload });
}

/** Answer every re-list that is waiting, inside one act. */
async function answerLists(): Promise<void> {
  await act(async () => {
    for (const next of list.pending.splice(0)) next();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

const makeHarness = () => createAppDialogsHarness({ deliver, events: fx.events, request: req });
const listCalls = () => core.calls.filter((c) => c.cmd === "list_drafts").length;
const logsOf = (event: string) => logs.filter((p) => p.event === event);
const RELOAD = { reloadMessage: "notes.md changed on disk" };
const ONE = [draft("d1", "One")];

beforeEach(() => {
  bus.window.clear();
  core.calls.length = 0;
  logs.length = 0;
  list.manual.value = false;
  list.result.value = ONE;
  list.fail.value = false;
  list.pending.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("D241-WI-2 admission (ADR-0116 Decisions 1 and 3)", () => {
  it("A1 with nothing else open, Recovery shows only once the re-list returns", async () => {
    list.manual.value = true;
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    expect(dialogFor("recovery")).toBeNull();
    expect(listCalls()).toBe(1);
    await answerLists();
    expect(dialogFor("recovery")).not.toBeNull();
    expect(logsOf("ui.recovery.released")).toHaveLength(1);
  });

  it("A2 drafts arriving under an open modal are held, with no re-list, until it closes", async () => {
    const h = makeHarness();
    render(<h.Harness initial={RELOAD} />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    await flush();
    expect(dialogFor("recovery")).toBeNull();
    expect(listCalls()).toBe(0);
    const held = logsOf("ui.recovery.held");
    expect(held).toHaveLength(1);
    expect(held[0].context).toEqual({ reason: "modal", count: 1 });

    act(() => h.set({ reloadMessage: null }));
    await flush();
    expect(dialogFor("recovery")).not.toBeNull();
    expect(listCalls()).toBe(1);
  });

  it("A3 a modal opening in the same commit as the drafts holds Recovery", async () => {
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => {
      h.set({ drafts: ONE });
      h.set(RELOAD);
    });
    await flush();
    expect(dialogFor("recovery")).toBeNull();
    expect(dialogFor("reload")).not.toBeNull();
    expect(listCalls()).toBe(0);
  });

  it("A4 drafts and an MCP request in the same act: MCP shows first, Recovery after it ends", async () => {
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    await act(async () => {
      h.set({ drafts: ONE });
      fire(fx.events.request, req("r1", "Doc r1"));
      await Promise.resolve();
    });
    await flush();
    expect(dialogFor("mcp")).not.toBeNull();
    expect(dialogFor("recovery")).toBeNull();
    expect(logsOf("ui.recovery.held")[0]?.context).toEqual({ reason: "mcp", count: 1 });

    await deliver(fx.events.resolved, { requestId: "r1", outcome: "approved" });
    await flush();
    expect(dialogFor("mcp")).toBeNull();
    expect(dialogFor("recovery")).not.toBeNull();
  });

  it("A5 a modal opened while the re-list is out keeps Recovery held; closing it re-lists and admits", async () => {
    list.manual.value = true;
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    act(() => h.set(RELOAD));
    await answerLists();
    expect(dialogFor("recovery")).toBeNull();
    expect(dialogFor("reload")).not.toBeNull();

    act(() => h.set({ reloadMessage: null }));
    expect(listCalls()).toBe(2);
    await answerLists();
    expect(dialogFor("recovery")).not.toBeNull();
  });

  it("A6 an MCP request arriving while the re-list is out wins: it shows, Recovery stays held", async () => {
    list.manual.value = true;
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    await deliver(fx.events.request, req("r1", "Doc r1"));
    await answerLists();
    expect(dialogFor("mcp")).not.toBeNull();
    expect(dialogFor("recovery")).toBeNull();
  });

  it("A7 an MCP request after admission and before Recovery's commit waits behind Recovery", async () => {
    list.manual.value = true;
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    await act(async () => {
      for (const next of list.pending.splice(0)) next();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      fire(fx.events.request, req("r1", "Doc r1"));
    });
    await flush();
    expect(dialogFor("recovery")).not.toBeNull();
    expect(dialogFor("mcp")).toBeNull();
  });

  it("A8 an empty re-list while the startup drafts are not settles: no Recovery, no further re-list", async () => {
    list.result.value = [];
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    await flush();
    expect(dialogFor("recovery")).toBeNull();
    act(() => h.set(RELOAD));
    await flush();
    act(() => h.set({ reloadMessage: null }));
    await flush();
    expect(dialogFor("recovery")).toBeNull();
    expect(listCalls()).toBe(1);
  });

  it("A9 the shown rows are the re-list's, limited to drafts the window still offers", async () => {
    list.result.value = [draft("d1", "One, fresher"), draft("d9", "Not offered")];
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: [draft("d1", "One"), draft("d2", "Two")] }));
    await flush();
    const card = screen.getByRole("dialog", { name: "Recover drafts" });
    expect(within(card).getByText("One, fresher")).toBeInTheDocument();
    expect(within(card).queryByText("Two")).toBeNull();
    expect(within(card).queryByText("Not offered")).toBeNull();
  });

  it("A10 a failed re-list falls back to the startup drafts", async () => {
    list.fail.value = true;
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    await flush();
    expect(within(screen.getByRole("dialog", { name: "Recover drafts" })).getByText("One")).toBeInTheDocument();
  });

  it("A11 unmounting while the re-list is out sets nothing and logs no release", async () => {
    list.manual.value = true;
    const h = makeHarness();
    const view = render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    view.unmount();
    await answerLists();
    expect(logsOf("ui.recovery.released")).toHaveLength(0);
  });
});

describe("D241-WI-2 after admission (ADR-0116 Decision 4)", () => {
  it("B1 admitted once: a modal opened over Recovery and closed does not hold or re-list it", async () => {
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    await flush();
    act(() => h.set(RELOAD));
    expect(dialogFor("recovery")).not.toBeNull();
    act(() => h.set({ reloadMessage: null }));
    await flush();
    expect(dialogFor("recovery")).not.toBeNull();
    expect(listCalls()).toBe(1);
  });

  it.each([
    ["Recover", "recoverDraft"],
    ["Discard", "discardDraft"],
  ])("B2 after the final row's %s, a fresh MCP request shows at once", async (button, handler) => {
    const user = userEvent.setup();
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    await flush();
    await user.click(screen.getByRole("button", { name: button }));
    expect(h.calls.at(-1)).toEqual({ handler, arg: "d1" });
    expect(dialogFor("recovery")).toBeNull();

    await deliver(fx.events.request, req("r1", "Doc r1"));
    expect(dialogFor("mcp")).not.toBeNull();
  });

  it.each([
    ["Recover", "recoverDraft"],
    ["Discard", "discardDraft"],
  ])("B3 an MCP request queued behind Recovery shows when the final row's %s closes it", async (button) => {
    const user = userEvent.setup();
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: ONE }));
    await flush();
    await deliver(fx.events.request, req("r1", "Doc r1"));
    expect(dialogFor("mcp")).toBeNull();

    await user.click(screen.getByRole("button", { name: button }));
    await flush();
    expect(dialogFor("recovery")).toBeNull();
    expect(dialogFor("mcp")).not.toBeNull();
  });

  it("B4 the g2 cost: a request that arrives after admission waits behind Recovery", async () => {
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    await deliver(fx.events.request, req("r1", "Doc r1"));
    act(() => h.set({ drafts: ONE }));
    await deliver(fx.events.resolved, { requestId: "r1", outcome: "approved" });
    await flush();
    expect(dialogFor("recovery")).not.toBeNull();
    await deliver(fx.events.request, req("r2", "Doc r2"));
    expect(dialogFor("recovery")).not.toBeNull();
    expect(dialogFor("mcp")).toBeNull();
  });
});
