/**
 * DevToolbar visibility — no visible dev UI in any mode; browser dev mode mounts only a
 * hidden file input (the fixture-loading hook used by the E5 snapshot harness).
 *
 * Specification: `.claude/tdd-guardian/tests-20261005-devtoolbar.md`, cases T2 … T4 (WI-1)
 * and T6 … T9 (WI-2), plan `.claude/tdd-guardian/plan-20261005-devtoolbar.md`.
 * WI-1's T1 (visible label + New / Open) and T5 (New click) were superseded by the user
 * decision of 2026-10-05 recorded in the plan's WI-2 and removed.
 *
 * The input mounts iff `import.meta.env.DEV` is true, with or without
 * `window.__TAURI_INTERNALS__`; otherwise (release) the component renders nothing.
 * T2 and T9 originally asserted nothing under `pnpm tauri dev`; the user decision of
 * 2026-10-07 reversed that so the E5 harness can load fixtures inside the WKWebView,
 * and both were rewritten to the new specification.
 *
 * No law: a two-input boolean gate; T2-T4 + T6/T7 enumerate the whole input space (S2).
 *
 * Mock boundary: only `@tauri-apps/api/core` (the `log_event` IPC behind
 * `loggingService`). Paired real path: `src-tauri/src/services/logger.rs`
 * `mod tests` (Rust lane).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: () => Promise.resolve(null),
}));

import { DevToolbar } from "../src/components/DevToolbar";

// Harness shim: jsdom 26 implements neither `Blob.prototype.text` nor `File.prototype.text`,
// which every browser the component runs in does. Back it with jsdom's real FileReader so
// T8 still reads the actual bytes of the uploaded file.
if (typeof Blob.prototype.text !== "function") {
  Object.defineProperty(Blob.prototype, "text", {
    configurable: true,
    value(this: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    },
  });
}

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

function setTauri(present: boolean) {
  if (present) {
    (window as TauriWindow).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as TauriWindow).__TAURI_INTERNALS__;
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete (window as TauriWindow).__TAURI_INTERNALS__;
});

describe("DevToolbar visibility", () => {
  it("T2: tauri dev (DEV=true, Tauri present) mounts one hidden, unfocusable file input and no visible UI", () => {
    vi.stubEnv("DEV", true);
    setTauri(true);

    render(<DevToolbar onOpenFile={vi.fn()} />);

    expect(screen.queryByText("DEV MODE")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const inputs = screen.queryAllByTestId("dev-open-file");
    expect(inputs).toHaveLength(1);
    const input = inputs[0] as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.hidden).toBe(true);
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute("aria-hidden")).toBe("true");
  });

  it("T3: production (DEV=false, no Tauri) renders nothing", () => {
    vi.stubEnv("DEV", false);
    setTauri(false);

    const { container } = render(<DevToolbar onOpenFile={vi.fn()} />);

    expect(container.innerHTML).toBe("");
  });

  it("T4: production app (DEV=false, Tauri present) renders nothing", () => {
    vi.stubEnv("DEV", false);
    setTauri(true);

    const { container } = render(<DevToolbar onOpenFile={vi.fn()} />);

    expect(container.innerHTML).toBe("");
  });

  it("T6: browser dev (DEV=true, no Tauri) shows no visible UI", () => {
    vi.stubEnv("DEV", true);
    setTauri(false);

    render(<DevToolbar onOpenFile={vi.fn()} />);

    expect(screen.queryByText("DEV MODE")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("T7: browser dev mounts exactly one hidden, unfocusable .md file input", () => {
    vi.stubEnv("DEV", true);
    setTauri(false);

    render(<DevToolbar onOpenFile={vi.fn()} />);

    const inputs = screen.queryAllByTestId("dev-open-file");
    expect(inputs).toHaveLength(1);
    const input = inputs[0] as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".md,.markdown");
    expect(input.hidden || getComputedStyle(input).display === "none").toBe(true);
    expect(input.tabIndex === -1 || input.hidden).toBe(true);
  });

  it("T8: choosing a file calls onOpenFile(content, name) and resets the input", async () => {
    vi.stubEnv("DEV", true);
    setTauri(false);
    const onOpenFile = vi.fn();
    const user = userEvent.setup();

    render(<DevToolbar onOpenFile={onOpenFile} />);
    const input = screen.getByTestId("dev-open-file") as HTMLInputElement;
    await user.upload(input, new File(["# hi"], "a.md", { type: "text/markdown" }));

    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("# hi", "a.md"));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
  });

  it("T9: tauri dev (DEV=true, Tauri present) loads a chosen file through onOpenFile", async () => {
    vi.stubEnv("DEV", true);
    setTauri(true);
    const onOpenFile = vi.fn();
    const user = userEvent.setup();

    render(<DevToolbar onOpenFile={onOpenFile} />);
    const input = screen.getByTestId("dev-open-file") as HTMLInputElement;
    await user.upload(input, new File(["# tauri"], "t.md", { type: "text/markdown" }));

    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("# tauri", "t.md"));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });
});
