/**
 * M7: Settings › Keyboard Shortcuts renders every command-table entry with
 * its capability, one case per row state of DESIGN.md's block ("Native menu
 * bar and Keyboard Shortcuts page", normative per D8), grouped per D14, with
 * fixed rows per the user's verdict 「A: every fixed row with a key」.
 *
 * Real component, real preferences and logging services. Mock boundary:
 * `@tauri-apps/api/core` only, as a stateful fake: `get_preferences` reads
 * `state.store` / `state.version`, `set_preferences` merges into
 * `state.store`, `get_applied_shortcuts` returns `state.applied` (the run's
 * snapshot, which a Save does not change: restart-to-apply, ADR-0114
 * Decision 4).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import type { AppliedBinding } from "../src/types/keyboardShortcuts";

const fake = vi.hoisted(() => {
  const state = {
    version: 1,
    store: {} as Record<string, string>,
    applied: null as Record<string, unknown> | null,
    writes: [] as Record<string, string>[],
  };
  const invoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    switch (cmd) {
      case "get_preferences":
        return { keyboardShortcutsVersion: state.version, keyboardShortcuts: { ...state.store } };
      case "set_preferences": {
        const prefs = (args?.preferences ?? {}) as { keyboardShortcuts?: Record<string, string> };
        const ks = prefs.keyboardShortcuts ?? {};
        state.writes.push({ ...ks });
        state.store = { ...state.store, ...ks };
        return { keyboardShortcutsVersion: state.version, keyboardShortcuts: { ...state.store } };
      }
      case "get_applied_shortcuts":
        if (state.applied === null) throw new Error("no snapshot");
        return { keyboardShortcutsVersion: state.version, source: "loaded", bindings: { ...state.applied } };
      default:
        return null;
    }
  };
  return { state, invoke };
});

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true, invoke: fake.invoke }),
);

import { KeyboardShortcutsSettings } from "../src/components/common/settings/KeyboardShortcutsSettings";

const boundAll = (store: Record<string, string>): Record<string, AppliedBinding> =>
  Object.fromEntries(Object.entries(store).map(([f, c]) => [f, { state: "bound", chord: c } as AppliedBinding]));

afterEach(() => {
  cleanup();
  delete (navigator as unknown as { platform?: string }).platform;
});

interface OpenOpts {
  platform?: string;
  version?: number;
  store?: Record<string, string>;
  applied?: Record<string, AppliedBinding> | null;
}

async function open(opts: OpenOpts = {}) {
  Object.defineProperty(navigator, "platform", { value: opts.platform ?? "MacIntel", configurable: true });
  fake.state.version = opts.version ?? 1;
  fake.state.store = { ...DEFAULT_KEYBOARD_SHORTCUTS, ...(opts.store ?? {}) };
  fake.state.applied = opts.applied === undefined ? boundAll(fake.state.store) : opts.applied;
  fake.state.writes = [];
  const closed: number[] = [];
  const view = render(<KeyboardShortcutsSettings onClose={() => closed.push(1)} />);
  await screen.findByText("Keyboard Shortcuts");
  return { closed, user: userEvent.setup(), view };
}

function row(label: string): HTMLElement {
  const el = screen.getByText(label, { selector: ".shortcut-label" }).closest(".shortcut-row");
  if (!(el instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return el;
}

const keyButton = (label: string) => row(label).querySelector("button");

async function record(user: ReturnType<typeof userEvent.setup>, label: string, keys: string) {
  const button = keyButton(label);
  if (!(button instanceof HTMLElement)) throw new Error(`no button for ${label}`);
  await user.click(button);
  await user.keyboard(keys);
}

async function clickSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Save" }));
  await Promise.resolve();
}

describe("M7 groups and fixed rows on the page", () => {
  it("c1 macOS shows the D14 groups in order, with the 9 fields the page lacked", async () => {
    await open();
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(["File", "Edit", "Paragraph", "Format", "View", "Table", "mdpro", "Window"]);
    for (const label of ["Open Quickly", "Export HTML", "Highlight", "Insert Row Above", "Delete Column"]) {
      expect(row(label)).toBeTruthy();
    }
    expect(within(row("Export HTML").closest("section") as HTMLElement).getByRole("heading").textContent).toBe("File");
    expect(within(row("Highlight").closest("section") as HTMLElement).getByRole("heading").textContent).toBe("Format");
  });

  it("c2 a fixed row shows its key in a non-editable box, not a button (Undo, Quit mdpro)", async () => {
    await open();
    for (const [label, key] of [["Undo", "Cmd+Z"], ["Redo", "Cmd+Shift+Z"], ["Quit mdpro", "Cmd+Q"]] as const) {
      expect(keyButton(label)).toBeNull();
      const box = row(label).querySelector(".shortcut-fixed");
      expect(box?.textContent).toBe(key);
      expect(box?.getAttribute("tabindex")).toBeNull();
    }
    expect(within(row("Undo").closest("section") as HTMLElement).getByRole("heading").textContent).toBe("Edit");
  });

  it("c3 Windows shows Redo as Ctrl+Y and no Exit row while Exit has no key", async () => {
    await open({ platform: "Win32" });
    expect(row("Redo").querySelector(".shortcut-fixed")?.textContent).toBe("Ctrl+Y");
    expect(screen.queryByText("Exit", { selector: ".shortcut-label" })).toBeNull();
    expect(screen.queryByText("Quit mdpro", { selector: ".shortcut-label" })).toBeNull();
  });
});

describe("M7 row states", () => {
  it("r1 Not available: muted name, status text in the key's place, no key button, a click records nothing", async () => {
    const { user, closed } = await open();
    const r = row("Save As");
    expect(r.classList.contains("is-unavailable")).toBe(true);
    expect(r.querySelector("button")).toBeNull();
    expect(r.querySelector(".shortcut-status")?.textContent).toBe("Not available");
    await user.click(r);
    expect(screen.queryByText("Press keys...")).toBeNull();
    await record(user, "Find Next", "{Meta>}j{/Meta}");
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(fake.state.writes[0]?.fileSaveAs).toBe(DEFAULT_KEYBOARD_SHORTCUTS.fileSaveAs);
  });

  it("r2 WYSIWYG only / Source only: the key button works and the capability line sits under the name", async () => {
    const { user } = await open();
    expect(row("Table").querySelector(".shortcut-capability")?.textContent).toBe("WYSIWYG only");
    expect(row("Bold").querySelector(".shortcut-capability")).toBeNull();
    expect(row("Find").querySelector(".shortcut-capability")?.textContent).toBe("Source only");
    expect(row("Save").querySelector(".shortcut-capability")).toBeNull();
    await record(user, "Find", "{Meta>}{Shift>}j{/Shift}{/Meta}");
    expect(keyButton("Find")?.textContent).toBe("Cmd+Shift+J");
  });

  it("r3 v2: Jump to Top is a System row, Replace its own row with ⌘H, and F6 the view toggle's fixed second key", async () => {
    await open({ version: 2, store: {}, applied: null });
    expect(keyButton("Jump to Top")).toBeNull();
    expect(row("Jump to Top").querySelector(".shortcut-fixed")?.textContent).toBe("System");
    expect(keyButton("Replace")?.textContent).toBe("Cmd+H");
    expect(keyButton("Find")?.textContent).toBe("Cmd+F");
    const seconds = [...row("Cycle View Mode").querySelectorAll(".shortcut-fixed.is-second")].map((e) => e.textContent);
    expect(seconds).toEqual(["F6"]);
  });

  it("r4 a conflict is flagged on the row and refuses Save, naming the other command", async () => {
    const { user } = await open();
    await record(user, "New", "{Meta>}z{/Meta}");
    expect(row("New").classList.contains("has-conflict")).toBe(true);
    const alert = screen.getAllByRole("alert").find((a) => a.textContent?.includes("Conflicting shortcuts detected"));
    expect(alert?.textContent).toMatch(/Undo/);
    await clickSave(user);
    expect(fake.state.writes).toHaveLength(0);
  });

  it("r5 an unassigned value shows as Not set", async () => {
    await open({ store: { fileNew: "<unassigned>" } });
    expect(keyButton("New")?.textContent).toBe("Not set");
  });

  it("r6 no changed-default text appears anywhere", async () => {
    const { view } = await open({ version: 2, store: {}, applied: null });
    expect(view.container.textContent).not.toMatch(/\bwas\b/i);
  });
});

describe("M7 pending rows (saved ≠ applied)", () => {
  const pendingOf = (label: string) => row(label).querySelector(".shortcut-pending")?.textContent ?? null;

  it("q1 a saved value the run does not use shows both keys, and unsaved edits do not change it", async () => {
    const { user } = await open({ store: { fileSave: "Cmd+Shift+K" }, applied: boundAll({ ...DEFAULT_KEYBOARD_SHORTCUTS }) });
    expect(pendingOf("Save")).toBe("Active: Cmd+S · after restart: Cmd+Shift+K");
    expect(pendingOf("New")).toBeNull();
    await record(user, "Save", "{Meta>}{Shift>}u{/Shift}{/Meta}");
    expect(keyButton("Save")?.textContent).toBe("Cmd+Shift+U");
    expect(pendingOf("Save")).toBe("Active: Cmd+S · after restart: Cmd+Shift+K");
    await record(user, "New", "{Meta>}{Shift>}y{/Shift}{/Meta}");
    expect(pendingOf("New")).toBeNull();
  });

  it("q2 Save, then reopen Settings: the new saved value is pending against the run's key", async () => {
    const { user, closed } = await open();
    await record(user, "Save", "{Meta>}{Shift>}y{/Shift}{/Meta}");
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    cleanup();
    render(<KeyboardShortcutsSettings onClose={() => {}} />);
    await screen.findByText("Keyboard Shortcuts");
    await waitFor(() => expect(pendingOf("Save")).toBe("Active: Cmd+S · after restart: Cmd+Shift+Y"));
  });

  it("q3 a new window's Settings reads the applied set, not the file", async () => {
    await open({ store: { fileNew: "Cmd+Shift+Y" }, applied: boundAll({ ...DEFAULT_KEYBOARD_SHORTCUTS }) });
    await waitFor(() => expect(pendingOf("New")).toBe("Active: Cmd+N · after restart: Cmd+Shift+Y"));
    expect(keyButton("New")?.textContent).toBe("Cmd+Shift+Y");
  });

  it("q4 with no applied snapshot there is no pending line and the page still works", async () => {
    await open({ store: { fileSave: "Cmd+Shift+K" }, applied: null });
    expect(keyButton("Save")?.textContent).toBe("Cmd+Shift+K");
    expect(pendingOf("Save")).toBeNull();
  });
});

describe("M7 Reset and the recorder", () => {
  it("e1 Reset at v1 writes today's defaults", async () => {
    const { user, closed } = await open({ store: { fileNew: "Cmd+Shift+Y" } });
    await user.click(screen.getByRole("button", { name: "Reset to Defaults" }));
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(fake.state.writes[0]).toEqual(DEFAULT_KEYBOARD_SHORTCUTS);
  });

  it("e2 Reset at v2 writes the table's v2 defaults, <unassigned> and <system> included", async () => {
    const { user, closed } = await open({ version: 2, store: {}, applied: null });
    await user.click(screen.getByRole("button", { name: "Reset to Defaults" }));
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(fake.state.writes[0]).toMatchObject({
      fileOpenQuickly: "<unassigned>",
      editDeleteWord: "<unassigned>",
      editJumpToTop: "<system>",
      paragraphQuote: "Cmd+Shift+B",
    });
  });

  it("e3 F6 records alone", async () => {
    const { user } = await open();
    await record(user, "Toggle Sidebar", "{F6}");
    expect(keyButton("Toggle Sidebar")?.textContent).toBe("F6");
  });

  it("e4 F12 records alone off-Mac too", async () => {
    const { user } = await open({ platform: "Win32" });
    await record(user, "Toggle Sidebar", "{F12}");
    expect(keyButton("Toggle Sidebar")?.textContent).toBe("F12");
  });
});
