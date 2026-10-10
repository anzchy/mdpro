// @vitest-environment node
/**
 * D74 — while a quit request is live, `create_window` refuses with
 * `window_refused_quit_pending`. That refusal is the quit guard protecting the
 * user's work, not a failure: `windowService.createWindow` must resolve `null`
 * (so the New Window menu shows no "Failed to open new window" toast and no
 * rejection escapes), and leave one `window.create` cancel line in the log.
 * Any other error still rejects, as before.
 *
 * Only the Tauri boundary (`invoke`) is mocked; `loggingService` is real and
 * reaches the log through the same mocked `invoke("log_event")`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  QUIT_PENDING_WINDOW_REFUSAL,
  windowService,
} from "../src/services/windowService";
import { useLoggingStore } from "../src/stores/loggingStore";

type Payload = { event: string; status: string; level: string; context?: unknown };

function logged(): Payload[] {
  return invoke.mock.calls
    .filter(([command]) => command === "log_event")
    .map(([, args]) => (args as { payload: Payload }).payload);
}

function rejectCreateWith(error: unknown) {
  invoke.mockImplementation(async (command: string) => {
    if (command === "create_window") throw error;
    return null;
  });
}

beforeEach(() => {
  invoke.mockReset();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("windowService.createWindow during a pending quit (D74)", () => {
  it("pins the refusal string the Rust gate returns", () => {
    expect(QUIT_PENDING_WINDOW_REFUSAL).toBe("window_refused_quit_pending");
  });

  it("resolves null instead of rejecting when the quit guard refuses", async () => {
    rejectCreateWith("window_refused_quit_pending");
    await expect(windowService.createWindow("/a.md")).resolves.toBeNull();
  });

  it("logs exactly one window.create cancel, with no path", async () => {
    rejectCreateWith("window_refused_quit_pending");
    await windowService.createWindow("/secret/a.md");
    const lines = logged().filter((p) => p.event === "window.create");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      status: "cancel",
      context: { reason: "quit_pending" },
    });
    expect(JSON.stringify(lines[0])).not.toContain("/secret/a.md");
  });

  it("still rejects for any other error", async () => {
    rejectCreateWith("Failed to create window: boom");
    await expect(windowService.createWindow()).rejects.toBe(
      "Failed to create window: boom",
    );
    expect(logged().filter((p) => p.event === "window.create")).toHaveLength(0);
  });

  it("still returns the window id on success", async () => {
    invoke.mockResolvedValue({ windowId: "mdpro-1" });
    await expect(windowService.createWindow()).resolves.toBe("mdpro-1");
  });
});
