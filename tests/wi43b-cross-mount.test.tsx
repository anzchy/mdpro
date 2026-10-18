/**
 * WI-4.3b round 3 (PR #508): settings writes across a close and reopen.
 *
 * Closing Settings unmounts every page; reopening mounts a new instance.
 * - N1: a closed page's queued writes are still sent, in order, ahead of a
 *   newer instance's; the group's writer outlives the page (round 4, PR #508:
 *   round 3 dropped them, which left the live app on a value never saved).
 *   More cases: wi43b-writer-registry.
 * - F508-3: a Shortcuts save that resolves after the dialog was closed and
 *   reopened does not close the new dialog or lose its edit.
 *
 * Mock boundary: `@tauri-apps/api/core` and spies on `preferencesService`; the
 * hook cases use a controlled `save` function.
 */
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { useSettingsWriter } from "../src/components/common/settings/useSettingsWriter";
import { preferencesService } from "../src/services/preferencesService";
import { useEditorStore } from "../src/stores/editorStore";
import { installBoundary } from "./support/settingsRowSites";
import { renderStatePage, stubAppliedShortcuts } from "./support/settingsStatePages";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (navigator as unknown as { platform?: string }).platform;
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

interface Slice {
  a: number;
  b: number;
}

interface Held<T> {
  value: T;
  resolve: () => void;
  reject: () => void;
}

function controlled<T>() {
  const sent: Held<T>[] = [];
  const save = vi.fn(
    (value: T) =>
      new Promise<void>((resolve, reject) => {
        sent.push({ value, resolve: () => resolve(), reject: () => reject(new Error("write failed")) });
      }),
  );
  return { save, sent };
}

let groupSeq = 0;

function mountWriter(group: string, save: (next: Slice) => Promise<unknown>) {
  const apply = vi.fn();
  const onConfirm = vi.fn();
  const hook = renderHook(() => useSettingsWriter<Slice>({ group, save, apply, onConfirm }));
  act(() => hook.result.current.load({ a: 0, b: 0 }));
  return { ...hook, apply, onConfirm };
}

describe("N1: the writer across unmount", () => {
  it("still sends the queued writes, in order, after the page closed", async () => {
    const { save, sent } = controlled<Slice>();
    const first = mountWriter(`g${(groupSeq += 1)}`, save);
    act(() => void first.result.current.write({ a: 1 }));
    act(() => void first.result.current.write({ a: 2 }));
    await settle();
    first.unmount();
    sent[0].resolve();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(sent.map((s) => s.value)).toEqual([
      { a: 1, b: 0 },
      { a: 2, b: 0 },
    ]);
  });

  it("with no newer instance, a closed page's late results reach the live app, the queued one included", async () => {
    const { save, sent } = controlled<Slice>();
    const first = mountWriter(`g${(groupSeq += 1)}`, save);
    act(() => void first.result.current.write({ a: 1 }));
    act(() => void first.result.current.write({ b: 2 }));
    await settle();
    first.unmount();
    sent[0].resolve();
    await settle();
    sent[1].resolve();
    await settle();
    expect(first.onConfirm).toHaveBeenCalledWith({ a: 1, b: 0 });
    expect(first.onConfirm).toHaveBeenLastCalledWith({ a: 1, b: 2 });
    expect(first.apply).not.toHaveBeenCalledWith("b", 0);
  });

  it("with no newer instance, a closed page's failed write returns the live app to confirmed", async () => {
    const { save, sent } = controlled<Slice>();
    const first = mountWriter(`g${(groupSeq += 1)}`, save);
    act(() => void first.result.current.write({ a: 1 }));
    await settle();
    first.unmount();
    sent[0].reject();
    await settle();
    expect(first.apply).toHaveBeenLastCalledWith("a", 0);
    expect(first.onConfirm).not.toHaveBeenCalled();
  });

  it("under a newer instance, a closed page's late result touches nothing", async () => {
    const group = `g${(groupSeq += 1)}`;
    const { save, sent } = controlled<Slice>();
    const first = mountWriter(group, save);
    act(() => void first.result.current.write({ a: 1 }));
    await settle();
    first.unmount();
    const applied = first.apply.mock.calls.length;

    const second = mountWriter(group, save);
    act(() => void second.result.current.write({ a: 5 }));
    await settle();
    sent[0].reject();
    await settle();
    sent[1].resolve();
    await settle();

    expect(first.apply).toHaveBeenCalledTimes(applied);
    expect(first.onConfirm).not.toHaveBeenCalled();
    expect(second.result.current.value).toEqual({ a: 5, b: 0 });
    expect(second.onConfirm).toHaveBeenLastCalledWith({ a: 5, b: 0 });
  });
});

describe("N1: General closed with two interval writes pending, then reopened", () => {
  async function scenario(oldOutcome: "resolve" | "reject") {
    const user = userEvent.setup();
    installBoundary();
    const held: Held<number | undefined>[] = [];
    vi.mocked(preferencesService.setPreferences).mockImplementation(
      (p) =>
        new Promise((resolve, reject) => {
          held.push({
            value: p.autoSaveInterval,
            resolve: () => resolve(p as never),
            reject: () => reject(new Error("write failed")),
          });
        }),
    );
    useEditorStore.setState({ autoSaveInterval: 30 });

    const first = renderStatePage("general");
    const interval = await screen.findByRole("combobox", { name: "Auto-save Interval" });
    await user.selectOptions(interval, "60");
    await user.selectOptions(interval, "120");
    await settle();
    first.unmount();

    renderStatePage("general");
    const reopened = await screen.findByRole("combobox", { name: "Auto-save Interval" });
    await user.selectOptions(reopened, "300");
    await settle();

    held[0][oldOutcome]();
    await settle();
    held.at(-1)?.resolve();
    await settle();
    return { held, reopened };
  }

  it("the old instance's 60 lands, its queued 120 is sent next, and the page and store end at 300", async () => {
    const { held, reopened } = await scenario("resolve");
    expect(held.map((h) => h.value)).toEqual([60, 120, 300]);
    expect(reopened).toHaveValue("300");
    expect(useEditorStore.getState().autoSaveInterval).toBe(300);
  });

  it("the old instance's 60 is rejected, and its rollback does not reach the store under the new instance", async () => {
    const { held, reopened } = await scenario("reject");
    expect(held.map((h) => h.value)).toEqual([60, 120, 300]);
    expect(reopened).toHaveValue("300");
    expect(useEditorStore.getState().autoSaveInterval).toBe(300);
  });
});

describe("F508-3: a Shortcuts save that resolves after close and reopen", () => {
  it("does not close the reopened dialog or lose its edit", async () => {
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    const user = userEvent.setup();
    installBoundary();
    stubAppliedShortcuts();
    const held: Held<unknown>[] = [];
    vi.mocked(preferencesService.setPreferences).mockImplementation(
      (p) =>
        new Promise((resolve, reject) => {
          held.push({ value: p, resolve: () => resolve(p as never), reject: () => reject(new Error("x")) });
        }),
    );
    const onClose = vi.fn();

    const first = renderStatePage("shortcuts", onClose);
    await user.click(await screen.findByRole("button", { name: "Reset to Defaults" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(held).toHaveLength(1);
    // Esc, the backdrop and × stay live during a save; closing unmounts the page.
    first.unmount();

    const second = renderStatePage("shortcuts", onClose);
    await screen.findByRole("button", { name: "Reset to Defaults" });
    const recorder = second.container.querySelector(".shortcut-row button");
    if (!(recorder instanceof HTMLElement)) throw new Error("no shortcut row");
    await user.click(recorder);
    await user.keyboard("{Meta>}{Alt>}j{/Alt}{/Meta}");
    expect(screen.getByText("Unsaved shortcut changes")).toBeInTheDocument();

    held[0].resolve();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved shortcut changes")).toBeInTheDocument();
  });
});
