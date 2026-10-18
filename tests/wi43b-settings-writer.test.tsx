/**
 * WI-4.3b round 2 (PR #508, F508-1..4): `useSettingsWriter`, the per-page
 * serialized settings writer.
 *
 * Contract:
 * - `write(patch)` shows the patch at once and queues its save after every
 *   earlier one. The value sent is built when the save is *sent*, from the last
 *   confirmed value plus this write's own patch, so a failed sibling never
 *   rides along.
 * - A failed write rolls back, to the last confirmed value, only the keys no
 *   later edit or write has claimed.
 * - `onConfirm` sees each confirmed value; `apply` sees every shown change.
 * - Unmounting mid-queue sends the write already in flight once and drops the
 *   queued ones (round 3, PR #508 N1: sending them later put a closed page's
 *   write over a reopened one's). Cross-mount cases: wi43b-cross-mount.
 *
 * Mock boundary: the `save` function passed in; it stands for the IPC call.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSettingsWriter } from "../src/components/common/settings/useSettingsWriter";

interface Slice {
  a: number;
  b: number;
}

const LOADED: Slice = { a: 0, b: 0 };

interface Pending {
  next: Slice;
  resolve: () => void;
  reject: () => void;
}

function controlledSave() {
  const sent: Pending[] = [];
  const save = vi.fn(
    (next: Slice) =>
      new Promise<void>((resolve, reject) => {
        sent.push({ next, resolve: () => resolve(), reject: () => reject(new Error("write failed")) });
      }),
  );
  return { save, sent };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

function mount(save: (next: Slice) => Promise<unknown>) {
  const apply = vi.fn();
  const onConfirm = vi.fn();
  const hook = renderHook(() => useSettingsWriter<Slice>({ save, apply, onConfirm }));
  act(() => hook.result.current.load(LOADED));
  return { ...hook, apply, onConfirm };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WI-4.3b: useSettingsWriter", () => {
  it("shows a write at once and sends one write at a time", async () => {
    const { save, sent } = controlledSave();
    const { result } = mount(save);
    act(() => void result.current.write({ a: 1 }));
    act(() => void result.current.write({ b: 2 }));
    expect(result.current.value).toEqual({ a: 1, b: 2 });
    await settle();
    expect(sent).toHaveLength(1);
    sent[0].resolve();
    await settle();
    expect(sent).toHaveLength(2);
  });

  it("success then failure: the key returns to the value the first write confirmed", async () => {
    const { save, sent } = controlledSave();
    const { result, onConfirm } = mount(save);
    act(() => void result.current.write({ a: 1 }));
    act(() => void result.current.write({ a: 2 }));
    await settle();
    sent[0].resolve();
    await settle();
    expect(onConfirm).toHaveBeenLastCalledWith({ a: 1, b: 0 });
    sent[1].reject();
    await settle();
    expect(result.current.value).toEqual({ a: 1, b: 0 });
  });

  it("failure then success: the later write is built from the confirmed value, not the failed one", async () => {
    const { save, sent } = controlledSave();
    const { result, apply } = mount(save);
    act(() => void result.current.write({ a: 1 }));
    act(() => void result.current.write({ b: 5 }));
    await settle();
    sent[0].reject();
    await settle();
    expect(result.current.value).toEqual({ a: 0, b: 5 });
    expect(apply).toHaveBeenLastCalledWith("a", 0);
    expect(sent[1].next).toEqual({ a: 0, b: 5 });
    sent[1].resolve();
    await settle();
    expect(result.current.value).toEqual({ a: 0, b: 5 });
  });

  it("two overlapping failures on one key end at the loaded value", async () => {
    const { save, sent } = controlledSave();
    const { result } = mount(save);
    act(() => void result.current.write({ a: 1 }));
    act(() => void result.current.write({ a: 2 }));
    await settle();
    sent[0].reject();
    await settle();
    expect(result.current.value).toEqual({ a: 2, b: 0 });
    sent[1].reject();
    await settle();
    expect(result.current.value).toEqual({ a: 0, b: 0 });
  });

  it("a later edit that claims the key keeps it through an in-flight failure", async () => {
    const { save, sent } = controlledSave();
    const { result } = mount(save);
    act(() => void result.current.write({ a: 1 }));
    act(() => result.current.edit({ a: 7 }));
    await settle();
    sent[0].reject();
    await settle();
    expect(result.current.value).toEqual({ a: 7, b: 0 });
    expect(sent).toHaveLength(1);
  });

  it("write resolves true when saved and false when not", async () => {
    const { save, sent } = controlledSave();
    const { result } = mount(save);
    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = result.current.write({ a: 1 });
      second = result.current.write({ b: 1 });
    });
    await settle();
    sent[0].resolve();
    await settle();
    sent[1].reject();
    await settle();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it("unmounting mid-queue sends the in-flight write once, drops the queued one, and sets no state", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { save, sent } = controlledSave();
    const { result, unmount, onConfirm } = mount(save);
    act(() => void result.current.write({ a: 1 }));
    act(() => void result.current.write({ b: 2 }));
    await settle();
    unmount();
    sent[0].resolve();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(sent.map((s) => s.next)).toEqual([{ a: 1, b: 0 }]);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it("an unsaved edit rides along in a write sent meanwhile, and is saved by it", async () => {
    const { save, sent } = controlledSave();
    const { result } = mount(save);
    act(() => result.current.edit({ a: 3 }));
    act(() => void result.current.write({ b: 1 }));
    await settle();
    expect(sent[0].next).toEqual({ a: 3, b: 1 });
    sent[0].resolve();
    await settle();
    act(() => void result.current.write({ b: 2 }));
    await settle();
    sent[1].reject();
    await settle();
    expect(result.current.value).toEqual({ a: 3, b: 1 });
  });

  it("with rollback off, a failed write keeps the value shown and carries it in the next write", async () => {
    const { save, sent } = controlledSave();
    const { result } = mount(save);
    act(() => void result.current.write({ a: 4 }, { rollback: false }));
    await settle();
    sent[0].reject();
    await settle();
    expect(result.current.value).toEqual({ a: 4, b: 0 });
    act(() => void result.current.write({ b: 1 }));
    await settle();
    expect(sent[1].next).toEqual({ a: 4, b: 1 });
  });

  it("does nothing before a value is loaded", async () => {
    const { save } = controlledSave();
    const { result } = renderHook(() => useSettingsWriter<Slice>({ save }));
    let saved: Promise<boolean> = Promise.resolve(true);
    act(() => {
      saved = result.current.write({ a: 1 });
    });
    await expect(saved).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(result.current.value).toBeNull();
  });
});
