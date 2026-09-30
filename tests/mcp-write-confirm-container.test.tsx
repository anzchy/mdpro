/**
 * ADR-0042 WI-8 — `McpWriteConfirm`, the container wiring `useMcpConfirm` to
 * `McpWriteConfirmDialog`. Case CT-2 of
 * `.claude/tdd-guardian/tests-20260929-102912.md` (revision 2).
 *
 * Mocked boundaries only: the webview-window `listen` (a fake bus, as in
 * `use-mcp-confirm.test.tsx`), core `invoke` (recorded) and `loggingService`.
 * The real hook, service and model run underneath.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Cb = (event: { payload: unknown }) => void;

const { bus, core } = vi.hoisted(() => ({
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  core: { calls: [] as Array<{ cmd: string; args: Record<string, unknown> }> },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: Cb) => {
      const set = bus.window.get(name) ?? new Set<Cb>();
      set.add(cb);
      bus.window.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    core.calls.push({ cmd, args: { ...args } });
    return "resolved";
  }),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

import { McpWriteConfirm } from "../src/components/common/McpWriteConfirm";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string }; samples: Array<Record<string, unknown>> };

const replace = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.window.get(name) ?? [])]) cb({ payload });
    await Promise.resolve();
  });
}

beforeEach(() => {
  bus.window.clear();
  core.calls.length = 0;
});

describe("McpWriteConfirm container (WI-8)", () => {
  it("CT-2 event → dialog → Approve → one reply sent, dialog gone", async () => {
    const user = userEvent.setup();
    render(<McpWriteConfirm />);
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();

    await deliver(fx.events.request, replace);
    const dialog = screen.getByRole("dialog", { name: /write confirmation/i });
    expect(dialog).toHaveAccessibleDescription(
      new RegExp(String(replace.documentTitle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await settle();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(core.calls.filter((c) => c.cmd === "mcp_confirm_reply")).toStrictEqual([
      { cmd: "mcp_confirm_reply", args: { requestId: replace.requestId, approved: true } },
    ]);
  });
});
