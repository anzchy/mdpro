import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";

const { invokeMock, focusHandler, unlisten } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
  focusHandler: { current: null as null | ((event: { payload: boolean }) => void) },
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      focusHandler.current = handler;
      return unlisten;
    },
  }),
}));

import { useRecentFilesMenuRefresh } from "../src/hooks/useRecentFilesMenuRefresh";

const refreshes = () => invokeMock.mock.calls.filter(([command]) => command === "sync_recent_files_menu");
const settle = async () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  invokeMock.mockClear();
  unlisten.mockClear();
  focusHandler.current = null;
  vi.mocked(isTauri).mockReturnValue(true);
});

it("reports the current mode on mount, mode change, and window focus", async () => {
  const hook = renderHook(({ mode }: { mode: "source" | "wysiwyg" }) =>
    useRecentFilesMenuRefresh(mode), { initialProps: { mode: "source" as "source" | "wysiwyg" } });
  await settle();
  expect(refreshes()).toHaveLength(1);
  await act(async () => { focusHandler.current?.({ payload: true }); });
  expect(refreshes()).toHaveLength(2);
  hook.rerender({ mode: "wysiwyg" });
  await settle();
  expect(refreshes()).toHaveLength(3);
  expect(refreshes().map(([, args]) => (args as { viewMode: string }).viewMode))
    .toEqual(["source", "source", "wysiwyg"]);
  hook.unmount();
  await settle();
  expect(unlisten).toHaveBeenCalledOnce();
});

it("reports the live tab count at the Tauri boundary after tabs change and focus returns", async () => {
  const hook = renderHook(({ count }: { count: number }) =>
    useRecentFilesMenuRefresh("source", undefined, count), { initialProps: { count: 1 } });
  await settle();
  expect(refreshes().at(-1)?.[1]).toMatchObject({ viewMode: "source", tabCount: 1 });
  hook.rerender({ count: 2 });
  await settle();
  expect(refreshes().at(-1)?.[1]).toMatchObject({ viewMode: "source", tabCount: 2 });
  await act(async () => { focusHandler.current?.({ payload: true }); });
  expect(refreshes().at(-1)?.[1]).toMatchObject({ viewMode: "source", tabCount: 2 });
  hook.unmount();
});
