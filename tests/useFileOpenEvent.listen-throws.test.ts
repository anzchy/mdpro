/**
 * D279-WI-4, HK-6 — a `getCurrentWindow().listen` that throws SYNCHRONOUSLY
 * is turned into a swallowed rejection: mounting and unmounting
 * `useFileOpenEvent` throw nothing, and vitest records no unhandled error or
 * rejection (it would fail this file on one).
 *
 * A sibling of `useFileOpenEvent.test.ts` so the shared harness is not edited.
 * Mock boundary: `@tauri-apps/api/window` only. Record-only: there is no
 * device path that throws here.
 */
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    listen: () => {
      throw new Error("no IPC");
    },
  }),
}));

import { useFileOpenEvent } from "../src/hooks/useFileOpenEvent";

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
};

it("HK-6: a synchronously throwing listen() neither throws out of mount nor unmount", async () => {
  const opened: string[][] = [];
  const openPaths = (paths: string[]) => {
    opened.push(paths);
    return Promise.resolve();
  };
  let h: ReturnType<typeof renderHook> | undefined;
  expect(() => {
    h = renderHook(() => useFileOpenEvent({ defaultViewMode: "wysiwyg", openPaths, setViewMode: () => {} }));
  }).not.toThrow();
  await flush();
  expect(() => h!.unmount()).not.toThrow();
  await flush();
  expect(opened).toEqual([]);
});
