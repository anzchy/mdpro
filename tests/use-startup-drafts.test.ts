/**
 * `useStartupDrafts` — the startup draft list, extracted from App.tsx unchanged.
 *
 * Mock boundary: `@tauri-apps/api/core` `invoke`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { useStartupDrafts } from "../src/hooks/useStartupDrafts";
import type { DraftMetadata } from "../src/services/draftService";

const DRAFT: DraftMetadata = { id: "d1", originalPath: "/tmp/a.md", lastModified: "2026-10-10T00:00:00Z", recovered: false, title: "a" };

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("useStartupDrafts", () => {
  it("prunes old drafts, then lists the rest", async () => {
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "list_drafts" ? [DRAFT] : null));
    const { result } = renderHook(() => useStartupDrafts());
    expect(result.current[0]).toEqual([]);
    await settle();
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual(["cleanup_old_drafts", "list_drafts"]);
    expect(result.current[0]).toEqual([DRAFT]);
  });

  it("a failed cleanup still lists", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "cleanup_old_drafts") throw new Error("nope");
      return [DRAFT];
    });
    const { result } = renderHook(() => useStartupDrafts());
    await settle();
    expect(result.current[0]).toEqual([DRAFT]);
  });

  it("a failed listing leaves the list empty", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_drafts") throw new Error("nope");
      return null;
    });
    const { result } = renderHook(() => useStartupDrafts());
    await settle();
    expect(result.current[0]).toEqual([]);
  });

  it("an answer after unmount sets nothing", async () => {
    let answer: (v: unknown) => void = () => {};
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_drafts" ? new Promise((r) => (answer = r)) : Promise.resolve(null),
    );
    const { result, unmount } = renderHook(() => useStartupDrafts());
    await settle();
    unmount();
    await act(async () => answer([DRAFT]));
    expect(result.current[0]).toEqual([]);
  });

  it("returns a setter that updates the list", async () => {
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "list_drafts" ? [DRAFT] : null));
    const { result } = renderHook(() => useStartupDrafts());
    await settle();
    act(() => result.current[1]((prev) => prev.filter((d) => d.id !== "d1")));
    expect(result.current[0]).toEqual([]);
  });
});
