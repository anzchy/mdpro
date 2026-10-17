/**
 * D235: with Insert Link open, Format › Insert Table opened Insert Table on top
 * of it (Stage 3 batch 5 device check). D165 refuses only the actions that
 * change tabs; the actions that open a modal (Insert Table, from the menu and
 * ⌘⌥T, and Preferences, from the menu and ⌘,) ran whatever was on screen.
 * They are now refused while a modal is open, with one log line, and still act
 * when none is.
 *
 * Mock boundary: the Tauri modules only (`event` = an in-memory `menu:action`
 * bus, `window` = a focused window, `core` invoke = log capture). Both hooks,
 * `loggingService`, the link store and the real LinkInsertModal run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type LogPayload = { event?: string; status?: string; context?: Record<string, unknown> };

const { menuBus, logs, subscribe } = vi.hoisted(() => {
  // `useKeyboardShortcuts` reads isMac once at module load; macOS is the only target.
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
  type HoistedCb = (event: { payload: unknown }) => void;
  return {
    menuBus: new Map<string, Set<HoistedCb>>(),
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
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") logs.push((args.payload as LogPayload | undefined) ?? {});
    return null;
  },
}));

import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import { useMenuEvents } from "../src/hooks/useMenuEvents";
import { LinkInsertModal } from "../src/components/Editor/LinkInsertModal";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";

async function menu(action: string): Promise<void> {
  await act(async () => {
    for (const cb of [...(menuBus.get("menu:action") ?? [])]) cb({ payload: { action, value: null, target: "main" } });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

const calls: string[] = [];
const handlers = {
  onInsertTable: () => void calls.push("insert-table"),
  onOpenPreferences: () => void calls.push("preferences"),
};

function Harness() {
  useMenuEvents(handlers);
  useKeyboardShortcuts(handlers);
  return <LinkInsertModal />;
}

function openLink() {
  act(() => useLinkInsertStore.getState().setPendingCallback(() => {}, "wysiwyg"));
  const url = screen.getByRole("textbox", { name: "URL" });
  act(() => url.focus());
}

const refusals = () => logs.filter((l) => l.status === "cancel" && l.context?.reason === "modal-open");

beforeEach(async () => {
  calls.length = 0;
  logs.length = 0;
  menuBus.clear();
  useLinkInsertStore.setState({ pendingCallback: null, mode: "wysiwyg" });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  render(<Harness />);
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
});

afterEach(() => {
  act(() => useLinkInsertStore.getState().clearPendingCallback());
  vi.unstubAllGlobals();
});

describe("D235 with Insert Link open, modal-opening actions do nothing", () => {
  it("Format › Insert Table from the menu does not open Insert Table", async () => {
    openLink();
    await menu("paragraph.table");
    expect(calls).toEqual([]);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("Preferences from the menu does not open Settings", async () => {
    openLink();
    await menu("file.preferences");
    expect(calls).toEqual([]);
  });

  it("⌘⌥T typed in the URL field does not open Insert Table", async () => {
    const user = userEvent.setup();
    openLink();
    await user.keyboard("{Meta>}{Alt>}t{/Alt}{/Meta}");
    expect(calls).toEqual([]);
  });

  it("⌘, typed in the URL field does not open Settings", async () => {
    const user = userEvent.setup();
    openLink();
    await user.keyboard("{Meta>},{/Meta}");
    expect(calls).toEqual([]);
  });

  it("each refusal logs one cancel line naming the action, its source and the reason", async () => {
    const user = userEvent.setup();
    openLink();
    await menu("paragraph.table");
    await user.keyboard("{Meta>}{Alt>}t{/Alt}{/Meta}");
    expect(refusals().map((l) => [l.event, l.context?.action, l.context?.source])).toEqual([
      ["ui.dialog.open", "paragraph.table", "menu"],
      ["ui.dialog.open", "paragraph.table", "shortcut"],
    ]);
  });

  it("the Insert Link dialog stays open and usable after a refusal", async () => {
    const user = userEvent.setup();
    openLink();
    await menu("paragraph.table");
    await user.type(screen.getByRole("textbox", { name: "URL" }), "https://x.io");
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveProperty("value", "https://x.io");
  });
});

describe("D235 with no modal open, the same actions still act", () => {
  it("menu Insert Table and Preferences run their handlers, and log no refusal", async () => {
    await menu("paragraph.table");
    await menu("file.preferences");
    expect(calls).toEqual(["insert-table", "preferences"]);
    expect(refusals()).toEqual([]);
  });

  it("⌘⌥T and ⌘, run their handlers", async () => {
    const user = userEvent.setup();
    await user.keyboard("{Meta>}{Alt>}t{/Alt}{/Meta}");
    await user.keyboard("{Meta>},{/Meta}");
    expect(calls).toEqual(["insert-table", "preferences"]);
  });
});
