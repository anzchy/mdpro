/**
 * M1A-WI-10: Settings → Keyboard Shortcuts refuses Save on a conflict that
 * involves a custom value with a shown side, names it in the banner, and
 * lets a hidden-only conflict through with a non-blocking notice (matrix
 * § M1A-WI-10, R1-12, SD13, SD14; user ruling 2026-10-16
 * 「A: custom only (Recommended)」).
 *
 * Real component, real preferences and logging services. Mock boundary:
 * `@tauri-apps/api/core` only, as a stateful fake (F9): `get_preferences`
 * reads `state.store` / `state.version`, `set_preferences` merges into
 * `state.store`, `log_event` is recorded. Paired integration for the real
 * `set_preferences` path: `src-tauri/src/commands/preferences_tests.rs` and
 * `tests/preferences-contract-parity.test.ts` (this WI adds no boundary).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { findSettingsConflicts } from "../src/commands/settingsConflicts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { V2_DEFAULTS } from "./support/bindingV2Defaults";

interface LogPayload {
  event: string;
  context: Record<string, unknown>;
}

const fake = vi.hoisted(() => {
  const state = {
    version: 1,
    store: {} as Record<string, string>,
    writes: [] as Record<string, string>[],
    logs: [] as { event: string; context: Record<string, unknown> }[],
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
      case "log_event":
        state.logs.push((args?.payload ?? {}) as { event: string; context: Record<string, unknown> });
        return null;
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

const F_A = "Cmd+J";
const F_B = "Cmd+Shift+J";
const F_C = "Cmd+Option+J";
const MAC_KEYS: Record<string, string> = {
  [F_A]: "{Meta>}j{/Meta}",
  [F_B]: "{Meta>}{Shift>}j{/Shift}{/Meta}",
  [F_C]: "{Meta>}{Alt>}j{/Alt}{/Meta}",
  "Cmd+Z": "{Meta>}z{/Meta}",
  "Cmd+N": "{Meta>}n{/Meta}",
  "Cmd+K": "{Meta>}k{/Meta}",
  "Cmd+Shift+S": "{Meta>}{Shift>}s{/Shift}{/Meta}",
  "Cmd+Shift+T": "{Meta>}{Shift>}t{/Shift}{/Meta}",
};

afterEach(() => {
  cleanup();
  delete (navigator as unknown as { platform?: string }).platform;
});

const v2Mac = (): Record<string, string> =>
  Object.fromEntries(Object.entries(V2_DEFAULTS).map(([f, [mac]]) => [f, mac]));

async function open(opts: { platform?: string; version?: number; store?: Record<string, string> } = {}) {
  Object.defineProperty(navigator, "platform", { value: opts.platform ?? "MacIntel", configurable: true });
  fake.state.version = opts.version ?? 1;
  fake.state.store = { ...DEFAULT_KEYBOARD_SHORTCUTS, ...(opts.store ?? {}) };
  fake.state.writes = [];
  fake.state.logs = [];
  const closed: number[] = [];
  render(<KeyboardShortcutsSettings onClose={() => closed.push(1)} />);
  await screen.findByText("Keyboard Shortcuts");
  return { closed, user: userEvent.setup(), before: { ...fake.state.store } };
}

function row(label: string): HTMLElement {
  const el = screen.getByText(label, { selector: ".shortcut-label" }).closest(".shortcut-row");
  if (!(el instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return el;
}

async function record(user: ReturnType<typeof userEvent.setup>, label: string, keys: string) {
  const button = row(label).querySelector("button");
  if (!(button instanceof HTMLElement)) throw new Error(`no button for ${label}`);
  await user.click(button);
  await user.keyboard(keys);
}

const conflictAlert = (): HTMLElement | undefined =>
  screen.queryAllByRole("alert").find((a) => a.textContent?.includes("Conflicting shortcuts detected"));

const refusedLogs = () =>
  fake.state.logs.filter((l: LogPayload) => l.event === "ui.settings.shortcuts.save" && l.context.status === "refused");

/** Counts only: no value in the context may be a chord. */
function expectNoChord(context: Record<string, unknown>) {
  expect(JSON.stringify(context)).not.toMatch(/Cmd|Ctrl|Option|Shift\+|⌘/);
}

async function clickSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Save" }));
  await Promise.resolve();
}

describe("M1A-WI-10 v1 defaults show no conflict and save an unrelated rebind", () => {
  it("macOS (including ⌘W held by Close and Close Window)", async () => {
    const { closed, user } = await open();
    expect(conflictAlert()).toBeUndefined();
    await record(user, "Find Next", MAC_KEYS[F_A] as string);
    expect(conflictAlert()).toBeUndefined();
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(fake.state.store.editFindNext).toBe(F_A);
  });

  it("Windows (Image/Italic, Source/H2 collide as data)", async () => {
    const { closed, user } = await open({ platform: "Win32" });
    expect(conflictAlert()).toBeUndefined();
    await record(user, "Find Next", "{Control>}j{/Control}");
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(fake.state.store.editFindNext).toBe("Cmd+J");
  });

  it("shows 49 rows: the 9 hidden fields have none (SD14)", async () => {
    await open();
    expect(document.querySelectorAll(".shortcut-row")).toHaveLength(49);
    for (const label of ["Highlight", "Highlight Selection", "Export HTML", "Open Quickly", "Insert Row Above"])
      expect(screen.queryByText(label, { selector: ".shortcut-label" })).toBeNull();
  });
});

describe("M1A-WI-10 refused Saves", () => {
  it("⌘Z for Save names Undo, marks the row, keeps the dialog and the store", async () => {
    const { closed, user, before } = await open();
    await record(user, "Save", MAC_KEYS["Cmd+Z"] as string);
    await clickSave(user);
    expect(conflictAlert()?.textContent).toContain("Save conflicts with Undo, not active");
    expect(row("Save").classList.contains("has-conflict")).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(fake.state.store).toEqual(before);
    expect(fake.state.writes).toHaveLength(0);
    expect(closed).toHaveLength(0);
    expect(refusedLogs()).toHaveLength(1);
    expectNoChord(refusedLogs()[0]?.context ?? {});
  });

  it("a new duplicate marks both rows and names New, Save and the chord", async () => {
    const { closed, user, before } = await open();
    await record(user, "New", MAC_KEYS[F_A] as string);
    await record(user, "Save", MAC_KEYS[F_A] as string);
    await clickSave(user);
    expect(row("New").classList.contains("has-conflict")).toBe(true);
    expect(row("Save").classList.contains("has-conflict")).toBe(true);
    expect(row("Open").classList.contains("has-conflict")).toBe(false);
    expect(conflictAlert()?.textContent).toContain("Cmd+J: New conflicts with Save");
    expect(fake.state.store).toEqual(before);
    expect(closed).toHaveLength(0);
  });

  it("⌘N for Save (New's available default) is refused and names New", async () => {
    const { closed, user, before } = await open();
    await record(user, "Save", MAC_KEYS["Cmd+N"] as string);
    await clickSave(user);
    expect(conflictAlert()?.textContent).toContain("Cmd+N: Save would take New's key");
    expect(fake.state.store).toEqual(before);
    expect(closed).toHaveLength(0);
  });

  it("⌘K for Save is refused and names Hyperlink", async () => {
    const { closed, user, before } = await open();
    await record(user, "Save", MAC_KEYS["Cmd+K"] as string);
    await clickSave(user);
    expect(conflictAlert()?.textContent).toContain("Save conflicts with Hyperlink, not active");
    expect(fake.state.store).toEqual(before);
    expect(closed).toHaveLength(0);
  });

  it("R1-12a hidden vs visible duplicate is refused and names Save and Highlight", async () => {
    const { closed, user, before } = await open({ store: { formatHighlight: F_A } });
    expect(conflictAlert()).toBeUndefined();
    await record(user, "Save", MAC_KEYS[F_A] as string);
    await clickSave(user);
    const text = conflictAlert()?.textContent ?? "";
    expect(text).toMatch(/Save/);
    expect(text).toMatch(/Highlight/);
    expect(row("Save").classList.contains("has-conflict")).toBe(true);
    expect(fake.state.store).toEqual(before);
    expect(closed).toHaveLength(0);
  });

  it("v2 from get_preferences: ⇧⌘T for Save takes Table's key (not the v1 duplicate form)", async () => {
    const { closed, user, before } = await open({ version: 2, store: v2Mac() });
    expect(conflictAlert()).toBeUndefined();
    await record(user, "Save", MAC_KEYS["Cmd+Shift+T"] as string);
    await clickSave(user);
    const text = conflictAlert()?.textContent ?? "";
    expect(text).toContain("Save would take Table's key");
    expect(text).not.toContain("conflicts with");
    expect(fake.state.store).toEqual(before);
    expect(closed).toHaveLength(0);
  });
});

describe("M1A-WI-10 allowed Saves", () => {
  it("custom vs an unavailable row's default (⇧⌘S, Save As) saves the value", async () => {
    const { closed, user } = await open();
    await record(user, "Save", MAC_KEYS["Cmd+Shift+S"] as string);
    expect(conflictAlert()).toBeUndefined();
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(fake.state.store.fileSave).toBe("Cmd+Shift+S");
    expect(fake.state.writes).toHaveLength(1);
  });

  it("R1-12b hidden vs hidden is a status notice, and Save still works and keeps both values", async () => {
    const { closed, user } = await open({ store: { formatHighlight: F_A, fileExportHtml: F_A } });
    const notice = screen.getByRole("status");
    expect(notice.textContent).toMatch(/Highlight/);
    expect(notice.textContent).toMatch(/Export HTML/);
    expect(conflictAlert()).toBeUndefined();
    await record(user, "Find Next", MAC_KEYS[F_B] as string);
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(fake.state.store.formatHighlight).toBe(F_A);
    expect(fake.state.store.fileExportHtml).toBe(F_A);
    expect(fake.state.store.editFindNext).toBe(F_B);
    const hidden = fake.state.logs.filter((l: LogPayload) => l.event === "ui.settings.shortcut_conflict_hidden");
    expect(hidden.length).toBeGreaterThan(0);
    expectNoChord(hidden[0]?.context ?? {});
  });
});

describe("M1A-WI-10 law: Save refused iff findSettingsConflicts(...).refusing is non-empty (S5)", () => {
  it("refuse → repair → accept, checked after every Save", async () => {
    const { closed, user } = await open();
    const model: Record<string, string> = { ...DEFAULT_KEYBOARD_SHORTCUTS };
    let writes = 0;
    const saveAndCheck = async (expectRefused: boolean) => {
      await clickSave(user);
      if (!expectRefused) await waitFor(() => expect(closed).toHaveLength(1));
      const refused = fake.state.writes.length === writes;
      writes = fake.state.writes.length;
      expect(refused).toBe(findSettingsConflicts("macos", 1, model).refusing.size > 0);
      expect(refused).toBe(expectRefused);
    };
    await record(user, "Save", MAC_KEYS["Cmd+Z"] as string);
    model.fileSave = "Cmd+Z";
    await saveAndCheck(true);
    await record(user, "Save", MAC_KEYS[F_A] as string);
    model.fileSave = F_A;
    await record(user, "New", MAC_KEYS[F_A] as string);
    model.fileNew = F_A;
    await saveAndCheck(true);
    await record(user, "New", MAC_KEYS[F_B] as string);
    model.fileNew = F_B;
    await saveAndCheck(false);
    expect(fake.state.store.fileSave).toBe(F_A);
    expect(fake.state.store.fileNew).toBe(F_B);
    expect(fake.state.writes).toHaveLength(1);
    expect(refusedLogs()).toHaveLength(2);
  });

  it("an older file holding a duplicate opens refused and saves once repaired", async () => {
    const { closed, user } = await open({ store: { fileNew: F_A, fileSave: F_A } });
    expect(conflictAlert()).toBeDefined();
    expect(row("New").classList.contains("has-conflict")).toBe(true);
    expect(row("Save").classList.contains("has-conflict")).toBe(true);
    await record(user, "Find Next", MAC_KEYS[F_B] as string);
    await clickSave(user);
    expect(fake.state.writes).toHaveLength(0);
    expect(closed).toHaveLength(0);
    await record(user, "New", MAC_KEYS[F_C] as string);
    expect(conflictAlert()).toBeUndefined();
    await clickSave(user);
    await waitFor(() => expect(closed).toHaveLength(1));
    expect(fake.state.store).toMatchObject({ editFindNext: F_B, fileNew: F_C, fileSave: F_A });
  });
});
