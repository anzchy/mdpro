// @vitest-environment node
/**
 * @module tableInsertStore.test
 * Purpose: Verify the table-insert store mirrors linkInsertStore — sets a
 * pending callback when a shortcut/menu requests insertion, the modal
 * resolves it, and clearing resets state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTableInsertStore } from "../src/stores/tableInsertStore";

describe("useTableInsertStore", () => {
  beforeEach(() => {
    useTableInsertStore.setState({ pendingCallback: null });
  });

  it("starts with no pending callback", () => {
    expect(useTableInsertStore.getState().pendingCallback).toBeNull();
  });

  it("requestInsert stores the callback (modal opens)", () => {
    const cb = vi.fn();
    useTableInsertStore.getState().requestInsert(cb);

    expect(useTableInsertStore.getState().pendingCallback).toBe(cb);
  });

  it("clearPending resets the callback (modal closes)", () => {
    const cb = vi.fn();
    useTableInsertStore.getState().requestInsert(cb);
    useTableInsertStore.getState().clearPending();

    expect(useTableInsertStore.getState().pendingCallback).toBeNull();
  });

  it("requestInsert overwrites a prior callback (last writer wins)", () => {
    const first = vi.fn();
    const second = vi.fn();
    useTableInsertStore.getState().requestInsert(first);
    useTableInsertStore.getState().requestInsert(second);

    expect(useTableInsertStore.getState().pendingCallback).toBe(second);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("the stored callback receives rows and cols when invoked by the modal", () => {
    const cb = vi.fn();
    useTableInsertStore.getState().requestInsert(cb);

    const stored = useTableInsertStore.getState().pendingCallback;
    expect(stored).not.toBeNull();
    stored?.(3, 4);

    expect(cb).toHaveBeenCalledWith(3, 4);
  });
});
