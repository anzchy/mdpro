/**
 * ADR-0042 WI-8 — `McpWriteConfirm`, the container wiring `useMcpConfirm` to
 * `McpWriteConfirmDialog`. Case CT-2 of
 * `.claude/tdd-guardian/tests-20260929-102912.md` (revision 2).
 *
 * Mocked boundaries only: the webview-window `listen` (a fake bus, as in
 * `use-mcp-confirm.test.tsx`) and core `invoke` (recorded). `loggingService` is
 * internal code, not a boundary, so it runs for real (D34 WI-7, T-2): its
 * `invoke("log_event", { payload })` calls land in the same recording, next to
 * `mcp_confirm_reply`. The real hook, service, model and logger run underneath.
 * Paired real paths: `src-tauri/src/commands/mcp_confirm_tests.rs` (the reply) and
 * `src-tauri/src/services/logger.rs` `mod tests` (the log line), Rust lane.
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

import { McpWriteConfirm } from "../src/components/common/McpWriteConfirm";
import { useLoggingStore } from "../src/stores/loggingStore";

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

/** The JSONL payloads the real `loggingService` handed to `invoke("log_event")`. */
const logLines = () =>
  core.calls
    .filter((c) => c.cmd === "log_event")
    .map((c) => c.args.payload as { event?: string; status?: string; context?: Record<string, unknown> });

beforeEach(() => {
  bus.window.clear();
  core.calls.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
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

    // D34 WI-7 (T-2, new): the real logger recorded the answer — one approve line, with
    // the request id and operation and no title; no reject line.
    const answers = logLines().filter((l) => /^ui\.mcp_confirm\.(approve|reject)$/.test(l.event ?? ""));
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      event: "ui.mcp_confirm.approve",
      status: "success",
      context: { requestId: replace.requestId, operation: "replace" },
    });
    expect(JSON.stringify(answers[0])).not.toContain(String(replace.documentTitle));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(core.calls.filter((c) => c.cmd === "mcp_confirm_reply")).toStrictEqual([
      { cmd: "mcp_confirm_reply", args: { requestId: replace.requestId, approved: true } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// D34 WI-3 — Escape through the real container and the real `useMcpConfirm` queue
// (CT-3 … CT-6 of `.claude/tdd-guardian/tests-20261001-100508.md`).
//
// Law (queue conservation): one qualifying Escape answers exactly one request, the head,
// with `approved:false`; no request is skipped, answered twice or answered unseen; an
// Escape after the queue empties answers nothing and is not consumed. Paired real path:
// Rust `src-tauri/src/services/mcp_confirm/http_tests.rs::h3_each_real_outcome_through_the_gate_yields_its_status`
// (reject → 403 USER_REJECTED) and `src-tauri/src/commands/mcp_confirm_tests.rs`.
// ---------------------------------------------------------------------------

const req = (id: string, title: string) => ({ ...replace, requestId: id, documentTitle: title });
const replies = () => core.calls.filter((c) => c.cmd === "mcp_confirm_reply");
const rejected = (id: string) => ({ cmd: "mcp_confirm_reply", args: { requestId: id, approved: false } });

function blurToBody() {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(document.activeElement).toBe(document.body);
}

/** Raw dispatch: reads the `dispatchEvent` return value and sets `repeat`. */
function escapeOn(target: EventTarget, extra: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...extra });
  let ok = true;
  act(() => {
    ok = target.dispatchEvent(ev);
  });
  return { ev, ok };
}

describe("McpWriteConfirm Escape (D34 WI-3)", () => {
  it("CT-3: Escape with focus on body sends exactly one approved:false reply and the prompt disappears", async () => {
    const user = userEvent.setup();
    render(<McpWriteConfirm />);
    await settle();
    await deliver(fx.events.request, req("r1", "Alpha"));
    expect(screen.getByRole("dialog", { name: /write confirmation/i })).toBeInTheDocument();
    blurToBody();
    await user.keyboard("{Escape}");
    await settle();
    expect(replies()).toStrictEqual([rejected("r1")]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("CT-4: two queued — Escape rejects r1 only; a repeat does not touch r2; a fresh Escape rejects r2", async () => {
    const user = userEvent.setup();
    render(<McpWriteConfirm />);
    await settle();
    await deliver(fx.events.request, req("r1", "Alpha"));
    await deliver(fx.events.request, req("r2", "Beta"));
    blurToBody();

    await user.keyboard("{Escape}");
    await settle();
    expect(replies()).toStrictEqual([rejected("r1")]);
    expect(screen.getByRole("dialog", { name: /write confirmation/i })).toHaveAccessibleDescription(/Beta/);
    expect(screen.getByRole("button", { name: "Reject" })).toHaveFocus();

    const repeat = escapeOn(document.activeElement ?? document.body, { repeat: true });
    await settle();
    expect(repeat.ok).toBe(false);
    expect(replies()).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: /write confirmation/i })).toHaveAccessibleDescription(/Beta/);

    await user.keyboard("{Escape}");
    await settle();
    expect(replies()).toStrictEqual([rejected("r1"), rejected("r2")]);
    expect(screen.queryByRole("dialog")).toBeNull();

    const after = escapeOn(document.body);
    expect(after.ok).toBe(true);
    expect(after.ev.defaultPrevented).toBe(false);
    expect(replies()).toHaveLength(2);
  });

  it("CT-5: two Escapes before React commits answer only the head", async () => {
    render(<McpWriteConfirm />);
    await settle();
    await deliver(fx.events.request, req("r1", "Alpha"));
    await deliver(fx.events.request, req("r2", "Beta"));
    blurToBody();

    const esc = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(esc());
      document.body.dispatchEvent(esc());
    });
    await settle();

    expect(replies()).toStrictEqual([rejected("r1")]);
    expect(screen.getByRole("dialog", { name: /write confirmation/i })).toHaveAccessibleDescription(/Beta/);
    expect(screen.getByRole("button", { name: "Reject" })).toHaveFocus();
  });

  it.each([1, 2, 3, 4])(
    "CT-6: PROPERTY — a queue of %i answers in order, each once, under n+1 Escapes",
    async (n) => {
      const user = userEvent.setup();
      render(<McpWriteConfirm />);
      await settle();
      const ids = Array.from({ length: n }, (_, i) => `r${i + 1}`);
      for (const id of ids) await deliver(fx.events.request, req(id, `Doc ${id}`));
      blurToBody();

      for (let i = 0; i < n; i += 1) {
        await user.keyboard("{Escape}");
        await settle();
        expect(replies()).toHaveLength(i + 1);
      }
      const last = escapeOn(document.activeElement ?? document.body);
      await settle();

      expect(replies().map((c) => [c.args.requestId, c.args.approved])).toStrictEqual(
        ids.map((id) => [id, false]),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(last.ok).toBe(true);
      expect(last.ev.defaultPrevented).toBe(false);
    },
  );
});
