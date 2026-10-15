/**
 * D189 / ADR-0088 decision 1: one fixed sidebar toggle, first in the bottom
 * tab bar. It swaps its icon and name, keeps its place and focus, calls the
 * toggle once with no arguments, and logs `ui.sidebar.toggle`.
 *
 * **Mocked:** only `@tauri-apps/api/core`, to observe the real
 * `loggingService`'s `log_event` payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { BottomTabs } from "../src/components/BottomTabs/BottomTabs";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { LogEntryPayload } from "../src/types/logging";

const noop = () => {};

function renderTabs(shown: boolean, onToggleSidebar = vi.fn()) {
  const view = render(
    <BottomTabs
      documents={[]}
      activeDocumentId={null}
      onSelect={noop}
      onClose={noop}
      onNewDocument={noop}
      sidebarShown={shown}
      onToggleSidebar={onToggleSidebar}
    />,
  );
  return { ...view, onToggleSidebar };
}

function toggleLogs(): LogEntryPayload[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: LogEntryPayload }).payload)
    .filter((p) => p.event === "ui.sidebar.toggle");
}

beforeEach(() => {
  invokeMock.mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

describe("D189 sidebar toggle button", () => {
  it("is the bottom bar's first control, before New Document", () => {
    renderTabs(true);
    const buttons = within(screen.getByRole("navigation")).getAllByRole("button");
    expect(buttons[0].getAttribute("aria-label")).toBe("Hide Sidebar (⌘⇧L)");
    expect(buttons[1].getAttribute("title")).toBe("New Document (⌘N)");
  });

  it("while shown: Hide Sidebar, expanded, controls the sidebar", () => {
    renderTabs(true);
    const button = screen.getByRole("button", { name: "Hide Sidebar (⌘⇧L)" });
    expect(button.getAttribute("title")).toBe("Hide Sidebar (⌘⇧L)");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe("app-sidebar");
  });

  it("while hidden: Show Sidebar, collapsed, and no dangling aria-controls", () => {
    renderTabs(false);
    const button = screen.getByRole("button", { name: "Show Sidebar (⌘⇧L)" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-controls")).toBe(false);
  });

  it("off-Mac the name carries Ctrl+Shift+L", () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    renderTabs(true);
    expect(screen.getByRole("button", { name: "Hide Sidebar (Ctrl+Shift+L)" })).toBeTruthy();
  });

  it("draws a different icon in each state, hidden from assistive tech", () => {
    const { rerender } = renderTabs(true);
    const svgShown = screen.getByRole("button", { name: /Sidebar/ }).querySelector("svg");
    expect(svgShown?.getAttribute("aria-hidden")).toBe("true");
    const shownMarkup = svgShown?.innerHTML;
    rerender(
      <BottomTabs
        documents={[]}
        activeDocumentId={null}
        onSelect={noop}
        onClose={noop}
        onNewDocument={noop}
        sidebarShown={false}
        onToggleSidebar={noop}
      />,
    );
    const svgHidden = screen.getByRole("button", { name: /Sidebar/ }).querySelector("svg");
    expect(svgHidden?.innerHTML).not.toBe(shownMarkup);
  });

  it("a click calls the toggle once, with no arguments, and keeps focus on the button", async () => {
    const { onToggleSidebar } = renderTabs(true);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Hide Sidebar (⌘⇧L)" });
    await user.click(button);
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(onToggleSidebar.mock.calls[0]).toEqual([]);
    expect(document.activeElement).toBe(button);
  });

  it("logs ui.sidebar.toggle with source button and the new state", async () => {
    renderTabs(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "Hide Sidebar (⌘⇧L)" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(toggleLogs().map((p) => p.context)).toEqual([{ source: "button", to: "hidden" }]);
  });
});

/** b137 Low (D189-WI-4): the name carries the user's live binding, not a fixed string. */
describe("D189-WI-4 the toggle names the live viewToggleSidebar binding", () => {
  function renderWith(shortcut: string | undefined, shown = true) {
    render(
      <BottomTabs
        documents={[]}
        activeDocumentId={null}
        onSelect={noop}
        onClose={noop}
        onNewDocument={noop}
        sidebarShown={shown}
        onToggleSidebar={noop}
        sidebarToggleShortcut={shortcut}
      />,
    );
    return screen.getAllByRole("button")[0];
  }

  it("the default binding reads as before", () => {
    expect(renderWith("Cmd+Shift+L").getAttribute("aria-label")).toBe("Hide Sidebar (⌘⇧L)");
  });

  it("a rebound shortcut shows on macOS as symbols", () => {
    const button = renderWith("Cmd+Option+S", false);
    expect(button.getAttribute("aria-label")).toBe("Show Sidebar (⌘⌥S)");
    expect(button.getAttribute("title")).toBe("Show Sidebar (⌘⌥S)");
  });

  it("a rebound shortcut shows off-Mac with Ctrl and Alt", () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    expect(renderWith("Cmd+Option+S").getAttribute("aria-label")).toBe("Hide Sidebar (Ctrl+Alt+S)");
  });

  it("a cleared binding names the action alone", () => {
    expect(renderWith("").getAttribute("aria-label")).toBe("Hide Sidebar");
  });

  it("no binding passed falls back to the default label", () => {
    expect(renderWith(undefined).getAttribute("aria-label")).toBe("Hide Sidebar (⌘⇧L)");
  });

  it("App passes the live binding to the bottom bar", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const app = readFileSync(join(__dirname, "..", "src/App.tsx"), "utf8");
    expect(app).toMatch(/sidebarToggleShortcut=\{keyboardShortcuts\.viewToggleSidebar\}/);
  });
});
