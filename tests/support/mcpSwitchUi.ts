/**
 * UI helpers shared by the ADR-0040 WI-10 live-switch suites
 * (`tests/settings-mcp-server-switch*.test.tsx`): open Settings → Integrations
 * against the `mcpSettingsHarness` route, find the toggles and the status
 * region by role, and count toasts.
 *
 * The suites own `vi.hoisted` + `vi.mock("@tauri-apps/api/core")`; this module
 * only queries the DOM and the toast store.
 */
import { expect } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { SettingsDialog } from "../../src/components/common/SettingsDialog";
import { useToastStore } from "../../src/stores/toastStore";

export const SERVER = /Enable MCP Server/i;
export const LAUNCH = /Start on launch/i;
export const SAVE_FAILED_TOAST = "Failed to save preferences";
export const UNREADABLE_NOTE = "Settings file unreadable — fix it to change this setting";
export const SAVED_ON_NOTE = "Saved as on — couldn't start";

type User = ReturnType<typeof userEvent.setup>;
const noop = () => {};

export function dialog(open: boolean) {
  return createElement(SettingsDialog, { open, onClose: noop });
}

export function server(): HTMLElement {
  return screen.getByRole("checkbox", { name: SERVER });
}

export function region(): HTMLElement {
  return screen.getByRole("status");
}

/** Navigate to Integrations and wait until the toggles are hydrated and the status shows. */
export async function openIntegrations(user: User): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Integrations" }));
  const toggle = await screen.findByRole("checkbox", { name: SERVER });
  await waitFor(() => expect(toggle).toBeEnabled());
  await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
}

/** Render a fresh dialog and open Integrations. */
export async function renderIntegrations(user: User) {
  const view = render(dialog(true));
  await openIntegrations(user);
  return view;
}

export function callsFor(invokeMock: { mock: { calls: unknown[][] } }, command: string): unknown[][] {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

/** Let queued promise callbacks run. */
export async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

/** Every toast message set from now on; call `stop` when done. */
export function recordToasts(): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const stop = useToastStore.subscribe((s) => {
    if (s.message !== null) seen.push(s.message);
  });
  return { seen, stop };
}
