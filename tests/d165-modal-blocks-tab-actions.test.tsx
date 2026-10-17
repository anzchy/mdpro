/**
 * D165 — an open App-level modal blocks the actions that change this window's tabs.
 *
 * Device evidence (docs/test/20261011-rc-c8bd2b6-a-device-check.md, item 8a / F3):
 * with the "External change detected" prompt up, ⌘W closed the tab behind it
 * (L16455 `tab.close`) and left the prompt orphaned on screen.
 *
 * Pinned here, on the real dispatch paths:
 *   - `menu:action` → `useMenuEvents` (the native accelerator's path on macOS) and a
 *     real `keydown` → `useKeyboardShortcuts`;
 *   - the real `AppDialogs` composition (via `appDialogsHarness`), so "a modal is open"
 *     is whatever the six App-level dialogs actually render;
 *   - while any of the six is open, close / new / open / open-recent do nothing to
 *     the real `documentStore` and log one refusal line
 *     (`tab.close` | `tab.open`, status `cancel`, `reason: "modal-open"`);
 *   - with no modal open, the same inputs still act;
 *   - the dialog's own buttons still work, and after Ignore ⌘W closes again.
 *
 * Mock boundary: the Tauri modules only (`event` = an in-memory `menu:action` bus,
 * `window` = a focused window, `webviewWindow` = the MCP prompt bus, `core` invoke =
 * log capture). `loggingService`, the stores, `AppDialogs` and both hooks are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Cb = (event: { payload: unknown }) => void;
type LogPayload = { event?: string; status?: string; context?: Record<string, unknown> };

const { menuBus, mcpBus, logs, subscribe } = vi.hoisted(() => {
  // `useKeyboardShortcuts` reads isMac once at module load; macOS is the only target.
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
  type HoistedCb = (event: { payload: unknown }) => void;
  return {
    menuBus: new Map<string, Set<HoistedCb>>(),
    mcpBus: new Map<string, Set<HoistedCb>>(),
    logs: [] as Array<{ event?: string; status?: string; context?: Record<string, unknown> }>,
    subscribe: (bus: Map<string, Set<HoistedCb>>) => async (name: string, cb: HoistedCb) => {
      const set = bus.get(name) ?? new Set<HoistedCb>();
      set.add(cb);
      bus.set(name, set);
      return () => void set.delete(cb);
    },
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main", listen: subscribe(menuBus) }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: subscribe(mcpBus) }),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") logs.push((args.payload as LogPayload | undefined) ?? {});
    if (cmd === "get_preferences") return (await import("./support/preferenceFixtures")).makePreferences();
    if (cmd === "mcp_confirm_reply") return "resolved";
    if (cmd === "mcp_get_installations") return [];
    return null;
  },
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { useMenuEvents } from "../src/hooks/useMenuEvents";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { Document } from "../src/types/document";
import { createAppDialogsHarness, HARNESS_DIALOG_IDS, type HarnessDialogId } from "./support/appDialogsHarness";

const fx = JSON.parse(readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8")) as {
  events: { request: string; resolved: string };
  samples: Array<Record<string, unknown>>;
};
const replaceSample = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function deliver(bus: Map<string, Set<Cb>>, name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.get(name) ?? [])]) cb({ payload });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

const menu = (action: string, value: string | null = null) =>
  deliver(menuBus, "menu:action", { action, value, target: "main" });

function doc(id: string): Document {
  return { id, path: `/x/${id}.md`, content: "", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 0 };
}

const opened: string[] = [];
let created = 0;

/** App's tab-changing handlers, reduced to their effect on the real document store. */
const handlers = {
  onClose: () => {
    const { activeDocumentId, closeDocument } = useDocumentStore.getState();
    if (activeDocumentId) closeDocument(activeDocumentId);
  },
  onNew: () => {
    created += 1;
    useDocumentStore.getState().upsertDocument(doc(`new-${created}`));
  },
  onOpen: () => void opened.push("dialog"),
  onOpenRecent: (path: string) => void opened.push(path),
};

function Dispatcher() {
  useMenuEvents(handlers);
  useKeyboardShortcuts(handlers);
  return null;
}

function mount() {
  const h = createAppDialogsHarness({
    deliver: (name, payload) => deliver(mcpBus, name, payload),
    events: fx.events,
    request: (requestId, title) => ({ ...replaceSample, requestId, documentTitle: title }),
  });
  render(
    <>
      <Dispatcher />
      <h.Harness />
    </>,
  );
  return h;
}

const ids = () => useDocumentStore.getState().documents.map((d) => d.id);
const refusals = () =>
  logs.filter((l) => l.status === "cancel" && l.context?.reason === "modal-open").map((l) => ({ event: l.event, ...l.context }));

beforeEach(() => {
  menuBus.clear();
  mcpBus.clear();
  logs.length = 0;
  opened.length = 0;
  created = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [doc("a"), doc("b")], activeDocumentId: "a" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("D165 — tab-changing actions are refused while an App-level modal is open", () => {
  it.each(HARNESS_DIALOG_IDS)("menu Close (⌘W accelerator) with %s open: no tab closes, one refusal logged", async (id: HarnessDialogId) => {
    const h = mount();
    await settle();
    await h.open(id);
    await settle();

    await menu("file.close");

    expect(ids()).toEqual(["a", "b"]);
    expect(logs.some((l) => l.event === "tab.close" && l.status === "success")).toBe(false);
    expect(refusals()).toEqual([{ event: "tab.close", action: "file.close", source: "menu", reason: "modal-open" }]);
  });

  it("the quit prompt (the confirm slot's quit target) blocks menu Close too", async () => {
    const h = mount();
    await settle();
    act(() => h.set({ quitPrompt: { requestId: 1 } }));
    await settle();
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeTruthy();

    await menu("file.close");

    expect(ids()).toEqual(["a", "b"]);
    expect(refusals()).toHaveLength(1);
  });

  it("menu New / Open / Open Recent with the Reload prompt open: nothing opens, each refusal logged", async () => {
    const h = mount();
    await settle();
    await h.open("reload");
    await settle();

    await menu("file.new");
    await menu("file.open");
    await menu("file.open_recent", "/x/recent.md");

    expect(ids()).toEqual(["a", "b"]);
    expect(opened).toEqual([]);
    expect(refusals()).toEqual([
      { event: "tab.open", action: "file.new", source: "menu", reason: "modal-open" },
      { event: "tab.open", action: "file.open", source: "menu", reason: "modal-open" },
      { event: "tab.open", action: "file.open_recent", source: "menu", reason: "modal-open" },
    ]);
  });

  it("⌘W / ⌘N / ⌘O keydown with the Reload prompt focused: nothing changes, each refusal logged", async () => {
    const user = userEvent.setup();
    const h = mount();
    await settle();
    await h.open("reload");
    await settle();

    await user.keyboard("{Meta>}w{/Meta}");
    await user.keyboard("{Meta>}n{/Meta}");
    await user.keyboard("{Meta>}o{/Meta}");

    expect(ids()).toEqual(["a", "b"]);
    expect(opened).toEqual([]);
    expect(refusals()).toEqual([
      { event: "tab.close", action: "file.close", source: "shortcut", reason: "modal-open" },
      { event: "tab.open", action: "file.new", source: "shortcut", reason: "modal-open" },
      { event: "tab.open", action: "file.open", source: "shortcut", reason: "modal-open" },
    ]);
  });

  it("the prompt's own Ignore still works, and ⌘W closes the tab once it is gone", async () => {
    const user = userEvent.setup();
    const h = mount();
    await settle();
    await h.open("reload");
    await settle();

    await user.click(screen.getByRole("button", { name: "Ignore" }));
    await settle();
    expect(h.calls).toEqual([{ handler: "ignoreReload" }]);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.keyboard("{Meta>}w{/Meta}");
    expect(ids()).toEqual(["b"]);
    expect(refusals()).toEqual([]);
  });

  it("with no modal open, menu and keyboard Close / New / Open act as before (no refusal)", async () => {
    const user = userEvent.setup();
    mount();
    await settle();

    await menu("file.close");
    expect(ids()).toEqual(["b"]);
    await user.keyboard("{Meta>}w{/Meta}");
    expect(ids()).toEqual([]);
    await menu("file.new");
    await user.keyboard("{Meta>}n{/Meta}");
    expect(ids()).toEqual(["new-1", "new-2"]);
    await menu("file.open");
    await user.keyboard("{Meta>}o{/Meta}");
    await menu("file.open_recent", "/x/recent.md");
    expect(opened).toEqual(["dialog", "dialog", "/x/recent.md"]);
    expect(refusals()).toEqual([]);
  });
});
