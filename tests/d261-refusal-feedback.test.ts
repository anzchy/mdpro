/**
 * D261-WI-1d review follow-up: a menu Save or a close-prompt Confirm that
 * its target token refuses must tell the user, not only the log (rule 60:
 * no silent discard of a save). Insert Table already toasts its refusal.
 *
 * Mock boundary: `@tauri-apps/api/{core,window}` only; stores and the
 * helpers are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { win, ipc } = vi.hoisted(() => ({
  win: { label: "A" },
  ipc: [] as Array<{ cmd: string }>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: win.label }),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string) => {
    if (cmd !== "log_event") ipc.push({ cmd });
    return null;
  },
}));

import { useDocumentStore } from "../src/stores/documentStore";
import { useToastStore } from "../src/stores/toastStore";
import {
  STALE_CLOSE_TOAST,
  STALE_SAVE_TOAST,
  captureToken,
  confirmDocumentClose,
  saveIfCurrent,
} from "../src/utils/menuTargetToken";
import { doc } from "./support/editorGenerationDomain";

const toast = () => useToastStore.getState().message;

beforeEach(() => {
  win.label = "A";
  ipc.length = 0;
  useToastStore.getState().clearToast();
  useDocumentStore.setState({ documents: [doc("d1", "one"), doc("d2", "two")], activeDocumentId: "d1" });
});

describe("a refused menu Save shows a toast", () => {
  it("stale token: nothing runs, the save toast is shown", async () => {
    const token = captureToken("A");
    useDocumentStore.getState().setActiveDocument("d2");
    const run = vi.fn(async () => {});
    expect(await saveIfCurrent(token, "act-1", run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(toast()).toBe(STALE_SAVE_TOAST);
  });

  it("missing token: nothing runs, the save toast is shown", async () => {
    const run = vi.fn(async () => {});
    expect(await saveIfCurrent(undefined, "act-2", run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(toast()).toBe(STALE_SAVE_TOAST);
  });

  it("current token: the save runs and no refusal toast is shown", async () => {
    const run = vi.fn(async () => {});
    expect(await saveIfCurrent(captureToken("A"), "act-3", run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(toast()).not.toBe(STALE_SAVE_TOAST);
  });
});

describe("a refused close-prompt Confirm shows a toast", () => {
  it("stale token: nothing closes, the close toast is shown", async () => {
    const token = captureToken("A");
    useDocumentStore.getState().setActiveDocument("d2");
    const close = vi.fn(async () => {});
    expect(await confirmDocumentClose(token, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(toast()).toBe(STALE_CLOSE_TOAST);
  });

  it("null token: nothing closes, the close toast is shown", async () => {
    const close = vi.fn(async () => {});
    expect(await confirmDocumentClose(null, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(toast()).toBe(STALE_CLOSE_TOAST);
  });

  it("current token: the close runs and no refusal toast is shown", async () => {
    const close = vi.fn(async () => {});
    expect(await confirmDocumentClose(captureToken("A"), close)).toBe(true);
    expect(close).toHaveBeenCalledWith(true);
    expect(toast()).not.toBe(STALE_CLOSE_TOAST);
  });

  it("the two refusals read differently", () => {
    expect(STALE_SAVE_TOAST).not.toBe(STALE_CLOSE_TOAST);
  });
});
