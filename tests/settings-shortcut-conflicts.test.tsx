/**
 * M1A-WI-10: Settings → Keyboard Shortcuts refuses Save on a conflict that
 * involves a custom value and names it in the banner (matrix § M1A-WI-10,
 * R1-12, SD13; user ruling 2026-10-16 「A: custom only (Recommended)」).
 * Since M7 every field has a row, so SD14's hidden-only notice is gone and
 * a conflict between the 9 fields it hid is refused like any other.
 *
 * Real component, real preferences and logging services. Mock boundary:
 * `@tauri-apps/api/core` only, as a stateful fake (F9): `get_preferences`
 * reads `state.store` / `state.version`, `set_preferences` merges into
 * `state.store`, `log_event` is recorded. Paired integration for the real
 * `set_preferences` path: `src-tauri/src/commands/preferences_tests.rs` and
 * `tests/preferences-contract-parity.test.ts` (this WI adds no boundary).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { findSettingsConflicts } from "../src/commands/settingsConflicts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/types/preferences";
import { V2_DEFAULTS } from "./support/bindingV2Defaults";
import legacyImageCases from "./fixtures/legacy-image-shortcut-cases.json";
import { collectionCases } from "./support/collectionCases";
import { v1TableDefaults } from "./support/bindingV1Defaults";
import { defaultAppliedShortcuts, appliedStoredShortcuts } from "../src/commands/appliedKeymap";
import { resolveBindings } from "../src/commands/bindingConflicts";
import { useKeyboardShortcuts } from "../src/hooks/useKeyboardShortcuts";
import type { AppliedShortcuts } from "../src/types/keyboardShortcuts";

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
    applied: null as AppliedShortcuts | null,
  };
  const invoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    switch (cmd) {
      case "get_preferences":
        return { keyboardShortcutsVersion: state.version, keyboardShortcuts: { ...state.store } };
      case "get_applied_shortcuts":
        return state.applied;
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
  "Cmd+S": "{Meta>}s{/Meta}",
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

async function open(opts: { platform?: string; version?: number; store?: Record<string, string>; applied?: AppliedShortcuts } = {}) {
  Object.defineProperty(navigator, "platform", { value: opts.platform ?? "MacIntel", configurable: true });
  fake.state.version = opts.version ?? 1;
  const host = opts.platform === "Win32" ? "windows" : opts.platform === "Linux" ? "linux" : "macos";
  fake.state.store = { ...(fake.state.version === 1 ? v1TableDefaults(host) : DEFAULT_KEYBOARD_SHORTCUTS), ...(opts.store ?? {}) };
  fake.state.writes = [];
  fake.state.logs = [];
  fake.state.applied = opts.applied ?? null;
  const closed: number[] = [];
  const view = render(<KeyboardShortcutsSettings onClose={() => closed.push(1)} />);
  await screen.findByText("Keyboard Shortcuts");
  return { closed, view, user: userEvent.setup(), before: { ...fake.state.store } };
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

  // M7 renders every command-table entry (plan § 6 M7): the 9 fields SD14 hid
  // get rows, beside the 58 configurable entries the macOS v1 page shows 12
  // fixed rows (user verdict 「A: every fixed row with a key」).
  it("shows 70 rows on macOS v1: every configurable field plus 12 fixed rows (M7)", async () => {
    await open();
    expect(document.querySelectorAll(".shortcut-row")).toHaveLength(70);
    for (const label of ["Highlight", "Export HTML", "Open Quickly", "Insert Row Above"])
      expect(screen.getByText(label, { selector: ".shortcut-label" })).toBeTruthy();
    expect(screen.queryByText("Highlight Selection", { selector: ".shortcut-label" })).toBeNull();
  });
});

for (const { platform, stored, expected } of collectionCases("legacy image Settings parity", legacyImageCases)) {
it(`D255-WI-3b Image read-time parity: ${platform} stored ${stored}`, async () => {
  const uiPlatform = platform === "macos" ? "MacIntel" : platform === "windows" ? "Win32" : "Linux";
  await open({ platform: uiPlatform, store: { formatImage: stored } });
  const row = screen.getByText("Image", { selector: ".shortcut-label" }).closest(".shortcut-row");
  const expectedForV1 = stored === "" ? v1TableDefaults(platform as "macos" | "windows" | "linux").formatImage : expected;
  expect(row?.querySelector(".shortcut-value")?.textContent).toBe(
    expectedForV1 === "<unassigned>" ? "Not set" : platform === "macos" ? expectedForV1 : expectedForV1.replace("Cmd", "Ctrl").replace("Option", "Alt"),
  );
  if (expected === "<unassigned>") expect(conflictAlert()).toBeUndefined();
  expect(fake.state.store.formatImage).toBe(stored);
  expect(fake.state.writes).toEqual([]);
});
}

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
  it("custom Save taking Save As's available default is refused", async () => {
    const { closed, user, before } = await open();
    await record(user, "Save", MAC_KEYS["Cmd+Shift+S"] as string);
    expect(conflictAlert()?.textContent).toContain("Save would take Save As's key");
    await clickSave(user);
    expect(closed).toHaveLength(0);
    expect(fake.state.store).toEqual(before);
    expect(fake.state.writes).toHaveLength(0);
  });

  // M7: SD14's notice went with the hidden set; the two fields now have rows.
  it("R1-12b (M7) two formerly hidden fields on one chord are refused, with no status notice", async () => {
    const { closed, user, before } = await open({ store: { formatHighlight: F_A, fileExportHtml: F_A } });
    expect(screen.queryByRole("status")).toBeNull();
    const text = conflictAlert()?.textContent ?? "";
    expect(text).toMatch(/Highlight/);
    expect(text).toMatch(/Export HTML/);
    expect(row("Highlight").classList.contains("has-conflict")).toBe(true);
    expect(row("Export HTML").classList.contains("has-conflict")).toBe(true);
    await record(user, "Find Next", MAC_KEYS[F_B] as string);
    await clickSave(user);
    expect(fake.state.store).toEqual(before);
    expect(closed).toHaveLength(0);
    expect(fake.state.logs.some((l: LogPayload) => l.event === "ui.settings.shortcut_conflict_hidden")).toBe(false);
    expect(refusedLogs()).toHaveLength(1);
    expect(refusedLogs()[0]?.context).toEqual({ status: "refused", refusing: 2 });
  });
});

describe("M1A-WI-10 law: Save refused iff findSettingsConflicts(...).refusing is non-empty (S5)", () => {
  it("refuse → repair → accept, checked after every Save", async () => {
    const { closed, user } = await open();
    const model: Record<string, string> = { ...v1TableDefaults("macos") };
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

it("AC-6 repairs a startup duplicate in Settings, keeps both inactive this run, then applies saved keys on restart", async () => {
  const duplicateStore = { ...DEFAULT_KEYBOARD_SHORTCUTS, fileNew: F_A, fileSave: F_A };
  const startupResolution = resolveBindings("macos", 2, duplicateStore);
  const startup = defaultAppliedShortcuts("macos");
  for (const field of ["fileNew", "fileSave"] as const) {
    const binding = startupResolution[field];
    if (binding.kind !== "suppressed") throw new Error(`${field} was not suppressed at startup`);
    startup.bindings[field] = { state: "suppressed", reason: binding.reason };
  }
  expect(startup.bindings.fileNew).toEqual({ state: "suppressed", reason: "customDuplicate" });
  expect(startup.bindings.fileSave).toEqual({ state: "suppressed", reason: "customDuplicate" });
  const { closed, view, user } = await open({
    version: 2, store: duplicateStore, applied: startup,
  });
  await waitFor(() => expect(row("New").textContent).toContain("Suppressed (customDuplicate) until restart"));
  expect(row("Save").textContent).toContain("Suppressed (customDuplicate) until restart");
  const onNew = vi.fn();
  const onSave = vi.fn();
  const running = renderHook(() => useKeyboardShortcuts({
    onNew, onSave, shortcuts: appliedStoredShortcuts(startup),
  }));
  const press = (key: string) => act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", {
    key, metaKey: true, bubbles: true, cancelable: true,
  })));
  press("j");
  expect(onNew).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();

  await record(user, "Save", MAC_KEYS["Cmd+S"] as string);
  expect(conflictAlert()).toBeUndefined();
  await clickSave(user);
  await waitFor(() => expect(closed).toHaveLength(1));
  expect(fake.state.writes).toHaveLength(1);
  expect(fake.state.store).toMatchObject({ fileNew: F_A, fileSave: "Cmd+S" });
  view.unmount();
  press("j");
  press("s");
  expect(onNew).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();

  // Reopen the real page against the persisted file and the same fixed run snapshot.
  const reopened = render(<KeyboardShortcutsSettings onClose={() => undefined} />);
  await screen.findByText("Keyboard Shortcuts");
  await waitFor(() => expect(row("Save").textContent).toContain("after restart: Cmd+S"));
  expect(row("New").textContent).toContain("after restart: Cmd+J");
  expect(row("New").textContent).toContain("Suppressed (customDuplicate) until restart");
  expect(row("Save").textContent).toContain("Suppressed (customDuplicate) until restart");
  reopened.unmount();
  press("j");
  press("s");
  expect(onNew).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  running.unmount();

  const resolutions = resolveBindings("macos", 2, fake.state.store);
  const restarted = defaultAppliedShortcuts("macos");
  for (const field of ["fileNew", "fileSave"] as const) {
    const binding = resolutions[field];
    if (binding.kind !== "bound") throw new Error(`${field} did not bind after restart`);
    restarted.bindings[field] = { state: "bound", chord: binding.chord };
  }
  expect(restarted.bindings.fileNew).toEqual({ state: "bound", chord: F_A });
  expect(restarted.bindings.fileSave).toEqual({ state: "bound", chord: "Cmd+S" });
  fake.state.applied = restarted;
  const nextSettings = render(<KeyboardShortcutsSettings onClose={() => undefined} />);
  await screen.findByText("Keyboard Shortcuts");
  await waitFor(() => expect(row("New").querySelector(".shortcut-pending")).toBeNull());
  expect(row("Save").querySelector(".shortcut-pending")).toBeNull();
  nextSettings.unmount();
  const nextRun = renderHook(() => useKeyboardShortcuts({
    onNew, onSave, shortcuts: appliedStoredShortcuts(restarted),
  }));
  press("j");
  press("s");
  expect(onNew).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
  nextRun.unmount();
});
