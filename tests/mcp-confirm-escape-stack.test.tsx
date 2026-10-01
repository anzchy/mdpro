/**
 * D34 WI-3 — the MCP write prompt on the shared Escape stack, composed with real dialogs.
 *
 * Specification: `.claude/tdd-guardian/tests-20261001-100508.md`, cases ES-1 … ES-4;
 * ES-5 … ES-7 are D34 WI-6 (review finding C-1: yield to a later unregistered modal).
 *
 * Law: with the App's `ConfirmDialog` and the MCP prompt both open, the first Escape answers
 * the one later in DOM order (MCP) regardless of which opened first, and the second cancels
 * the ConfirmDialog; no Escape log line carries the document title or id. Covered at S4 by
 * ES-1 (both open orders, exhaustive) and over every captured line by ES-4.
 *
 * Mock boundaries: `@tauri-apps/api/webviewWindow` (a fake bus, as in
 * `mcp-write-confirm-container.test.tsx`) and `@tauri-apps/api/core` `invoke`, routed:
 * `mcp_confirm_reply` → recorded, `log_event` → `logs` (the JSONL payload that would reach
 * Rust), the SettingsDialog loads → fixtures. `loggingService` / `loggingStore` are real.
 * Paired real paths (Rust lane): `services/mcp_confirm/http_tests.rs::h3_each_real_outcome_through_the_gate_yields_its_status`
 * (reject → 403 USER_REJECTED), `commands/mcp_confirm_tests.rs::r6_reply_lines_through_the_core_never_carry_the_title`,
 * and `services/logger.rs` `mod tests`.
 *
 * jsdom cannot reproduce WKWebView focus: "blur to body" simulates the D34 hypothesis only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Cb = (event: { payload: unknown }) => void;
type LogPayload = { event?: string; context?: Record<string, unknown>; [key: string]: unknown };

const { bus, core, logs } = vi.hoisted(() => ({
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  core: { calls: [] as Array<{ cmd: string; args: Record<string, unknown> }> },
  logs: [] as Array<{ event?: string; context?: Record<string, unknown>; [key: string]: unknown }>,
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
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "log_event") {
      logs.push((args.payload as LogPayload | undefined) ?? {});
      return null;
    }
    core.calls.push({ cmd, args: { ...args } });
    switch (cmd) {
      case "mcp_confirm_reply":
        return "resolved";
      case "get_preferences":
        return (await import("./support/preferenceFixtures")).makePreferences();
      case "mcp_get_status":
        return { running: false, port: null, binaryPath: "b", phase: "disabled", error: null, configured: "disabled" };
      case "mcp_get_installations":
        return [];
      default:
        return null;
    }
  },
}));

import { ConfirmDialog } from "../src/components/common/ConfirmDialog";
import { McpWriteConfirm } from "../src/components/common/McpWriteConfirm";
import { ReloadDialog } from "../src/components/common/ReloadDialog";
import { SettingsDialog } from "../src/components/common/SettingsDialog";
import { useLoggingStore } from "../src/stores/loggingStore";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string }; samples: Array<Record<string, unknown>> };
const replace = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;
const req = (id: string, title: string) => ({ ...replace, requestId: id, documentTitle: title });
const replies = () => core.calls.filter((c) => c.cmd === "mcp_confirm_reply");
const rejected = (id: string) => ({ cmd: "mcp_confirm_reply", args: { requestId: id, approved: false } });
const escapeLines = () => logs.filter((p) => p.event === "ui.dialog.escape");

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

function blurToBody() {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(document.activeElement).toBe(document.body);
}

function escapeOn(target: EventTarget) {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  let ok = true;
  act(() => {
    ok = target.dispatchEvent(ev);
  });
  return { ev, ok };
}

const mcpDialog = () => screen.queryByRole("dialog", { name: /write confirmation/i });
const unsavedDialog = () => screen.queryByRole("dialog", { name: "Unsaved changes" });

// ---------------------------------------------------------------------------
// App-like harness: mirrors App.tsx DOM order — `<ConfirmDialog>` (L1049) before
// `<McpWriteConfirm/>` (L1065). If App's order changes, ADR-0045 must be revisited and this
// harness with it: the expected Escape order follows DOM order, not open order.
// ---------------------------------------------------------------------------

let cancels = 0;
let confirms = 0;
let openDirty: () => void = () => {};

function AppLike() {
  const [dirtyOpen, setDirtyOpen] = useState(false);
  openDirty = () => setDirtyOpen(true);
  return (
    <>
      <ConfirmDialog
        open={dirtyOpen}
        title="Unsaved changes"
        message="Save TOP-SECRET-ROADMAP.md?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          confirms += 1;
          setDirtyOpen(false);
        }}
        onCancel={() => {
          cancels += 1;
          setDirtyOpen(false);
        }}
      />
      <McpWriteConfirm />
    </>
  );
}

beforeEach(() => {
  bus.window.clear();
  core.calls.length = 0;
  logs.length = 0;
  cancels = 0;
  confirms = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(() => {
  openDirty = () => {};
});

describe("MCP prompt on the shared Escape stack (D34 WI-3)", () => {
  it.each(["confirm-then-mcp", "mcp-then-confirm"] as const)(
    "ES-1: G5b, open order %s — Escape 1 rejects MCP only, Escape 2 cancels the ConfirmDialog",
    async (order) => {
      const user = userEvent.setup();
      render(<AppLike />);
      await settle();
      const openConfirm = () =>
        act(() => {
          openDirty();
        });
      const openMcp = () => deliver(fx.events.request, req("r1", "Alpha"));
      if (order === "confirm-then-mcp") {
        openConfirm();
        await openMcp();
      } else {
        await openMcp();
        openConfirm();
      }
      expect(mcpDialog()).not.toBeNull();
      expect(unsavedDialog()).not.toBeNull();
      blurToBody();

      await user.keyboard("{Escape}");
      await settle();
      expect(replies()).toStrictEqual([rejected("r1")]);
      expect(mcpDialog()).toBeNull();
      expect(unsavedDialog()).not.toBeNull();
      expect(cancels).toBe(0);

      await user.keyboard("{Escape}");
      await settle();
      expect(unsavedDialog()).toBeNull();
      expect(cancels).toBe(1);
      expect(confirms).toBe(0);
      expect(replies()).toHaveLength(1);

      const third = escapeOn(document.activeElement ?? document.body);
      expect(third.ok).toBe(true);
      expect(third.ev.defaultPrevented).toBe(false);
      expect(escapeLines().map((p) => p.context?.dialog)).toStrictEqual(["mcp_write_confirm", "confirm"]);
    },
  );

  it("ES-2: MCP prompt above the real SettingsDialog — only MCP closes; Settings' own Escape works afterwards", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let settingsCloses = 0;
    const user = userEvent.setup();
    render(
      <>
        <SettingsDialog open onClose={() => (settingsCloses += 1)} />
        <McpWriteConfirm />
      </>,
    );
    await screen.findByRole("dialog", { name: "Settings" });
    await settle();
    await deliver(fx.events.request, req("r1", "Alpha"));
    expect(mcpDialog()).not.toBeNull();

    const general = screen.getByRole("button", { name: "General" });
    await user.click(general);
    expect(general).toHaveFocus();
    await user.keyboard("{Escape}");
    await settle();
    expect(mcpDialog()).toBeNull();
    expect(replies()).toStrictEqual([rejected("r1")]);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(settingsCloses).toBe(0);

    await user.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByRole("button", { name: "General" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(settingsCloses).toBe(1);
  });

  it("ES-3: MCP prompt above a stand-in card-Escape dialog — the stand-in stays open", async () => {
    let standInClosed = 0;
    const user = userEvent.setup();
    render(
      <>
        <div
          role="dialog"
          aria-label="Stand-in"
          onKeyDown={(e) => {
            if (e.key === "Escape") standInClosed += 1;
          }}
        >
          <button type="button">inside</button>
        </div>
        <McpWriteConfirm />
      </>,
    );
    await settle();
    await deliver(fx.events.request, req("r1", "Alpha"));
    const inside = screen.getByRole("button", { name: "inside" });
    await user.click(inside);
    expect(inside).toHaveFocus();
    await user.keyboard("{Escape}");
    await settle();
    expect(mcpDialog()).toBeNull();
    expect(replies()).toStrictEqual([rejected("r1")]);
    expect(standInClosed).toBe(0);
  });

  it("ES-4: REDACTION — no log line on the Escape-reject path carries the document title or id", async () => {
    const user = userEvent.setup();
    render(<McpWriteConfirm />);
    await settle();
    await deliver(fx.events.request, {
      ...replace,
      requestId: "r1",
      documentId: "DOCID-zq81",
      documentTitle: "TOP-SECRET-ROADMAP.md",
    });
    expect(mcpDialog()).not.toBeNull();
    blurToBody();
    await user.keyboard("{Escape}");
    await settle();

    expect(mcpDialog()).toBeNull();
    expect(logs.length).toBeGreaterThan(0);
    for (const p of logs) {
      const line = JSON.stringify(p);
      expect(line).not.toContain("TOP-SECRET-ROADMAP");
      expect(line).not.toContain("DOCID-zq81");
    }
    const esc = escapeLines();
    expect(esc).toHaveLength(1);
    expect(esc[0].context).toStrictEqual({ dialog: "mcp_write_confirm", outcome: "reject" });
    expect(logs.some((p) => p.event === "ui.mcp_confirm.reject")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D34 WI-6 — review finding C-1 / M-1: a registered ConfirmDialog must YIELD to an
// unregistered modal rendered later in the DOM (App.tsx renders BottomTabs' / Sidebar's
// ConfirmDialog before Reload / Recovery / Encoding / Settings), and must not yield to one
// rendered earlier (App's own "Unsaved changes" ConfirmDialog follows Reload).
// ---------------------------------------------------------------------------

describe("ConfirmDialog yields Escape to a later unregistered modal (D34 WI-6)", () => {
  function deleteConfirm(onCancel: () => void) {
    return (
      <ConfirmDialog
        open
        title="Delete file"
        message="Delete notes.md?"
        onConfirm={() => {
          confirms += 1;
        }}
        onCancel={onCancel}
      />
    );
  }
  const deleteDialog = () => screen.queryByRole("dialog", { name: "Delete file" });

  it("ES-5: a later sibling aria-modal with its own Escape handler gets Escape; the ConfirmDialog is not cancelled", () => {
    let laterEsc = 0;
    render(
      <>
        {deleteConfirm(() => (cancels += 1))}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Later modal"
          onKeyDown={(e) => {
            if (e.key === "Escape") laterEsc += 1;
          }}
        >
          <button type="button">later-inside</button>
        </div>
      </>,
    );
    const inside = screen.getByRole("button", { name: "later-inside" });
    act(() => inside.focus());
    expect(inside).toHaveFocus();

    const { ev, ok } = escapeOn(inside);

    expect(laterEsc).toBe(1);
    expect(cancels).toBe(0);
    expect(ok).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    expect(deleteDialog()).not.toBeNull();
    expect(escapeLines()).toStrictEqual([]);

    // Focus on body: the visible later modal does not get it (its handler is focus-bound),
    // but the hidden ConfirmDialog still must not be cancelled.
    blurToBody();
    const fromBody = escapeOn(document.body);
    expect(fromBody.ok).toBe(true);
    expect(fromBody.ev.defaultPrevented).toBe(false);
    expect(cancels).toBe(0);
    expect(deleteDialog()).not.toBeNull();
  });

  it("ES-6: the real ReloadDialog rendered after an open ConfirmDialog receives Escape (Ignore)", () => {
    let ignores = 0;
    render(
      <>
        {deleteConfirm(() => (cancels += 1))}
        <ReloadDialog open message="notes.md changed on disk" onReload={() => {}} onIgnore={() => (ignores += 1)} />
      </>,
    );
    const reloadButton = screen.getByRole("button", { name: "Reload" });
    act(() => reloadButton.focus());

    const { ev, ok } = escapeOn(reloadButton);

    expect(ignores).toBe(1);
    expect(cancels).toBe(0);
    expect(ok).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    expect(deleteDialog()).not.toBeNull();
    expect(escapeLines()).toStrictEqual([]);
  });

  it("ES-7: an unregistered ReloadDialog EARLIER in the DOM does not block the ConfirmDialog after it", () => {
    let ignores = 0;
    render(
      <>
        <ReloadDialog open message="notes.md changed on disk" onReload={() => {}} onIgnore={() => (ignores += 1)} />
        {deleteConfirm(() => (cancels += 1))}
      </>,
    );
    blurToBody();

    const { ev, ok } = escapeOn(document.body);

    expect(cancels).toBe(1);
    expect(ignores).toBe(0);
    expect(ok).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
    expect(escapeLines().map((p) => p.context)).toStrictEqual([{ dialog: "confirm", outcome: "cancel" }]);
  });
});
