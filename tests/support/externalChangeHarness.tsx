/**
 * Purpose: shared harness for the D171 external-change cases. It renders App's
 * real external-change wiring (`useExternalChangePrompt`, fed by the real
 * `useDocument`); the controllable `invoke` lives in `externalChangeIpc.ts`.
 *
 * Wiring, in a test file:
 *   vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
 *   vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
 *   vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);
 */
import { useState } from "react";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import { useDocument } from "../../src/hooks/useDocument";
import { useExternalChangePrompt } from "../../src/hooks/useExternalChangePrompt";
import type { Document } from "../../src/types/document";
import { bus, makeDoc } from "../helpers/fileWatcherLogHarness";
export { deferred, ipcCalls, ipcCount, onIpc, resetExternalChangeHarness } from "./externalChangeIpc";

export const MODIFIED_MSG = "File was modified externally. Reload to update content?";
export const DELETED_MSG = "File was deleted externally. Save to a new location if needed.";

export const A = makeDoc({ id: "a", path: "/tmp/a.md", content: "# a\n" });
export const B = makeDoc({ id: "b", path: "/tmp/b.md", content: "# b\n" });

/** What the harness exposes after each render. */
export interface PromptView {
  reloadMessage: string | null;
  busyLabel: string | null;
  handleReloadFile: () => Promise<void>;
  handleIgnoreReload: () => void;
  replaceDocument: (document: Document) => void;
  api: ReturnType<typeof useDocument>;
}

export const view: { current: PromptView | null } = { current: null };

function Harness() {
  const api = useDocument();
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const showToast = (message: string) => {
    toasts.push(message);
  };
  const prompt = useExternalChangePrompt({
    activeDocument: api.activeDocument,
    replaceDocument: api.replaceDocument,
    showToast,
    setBusyLabel,
  });
  view.current = { ...prompt, busyLabel, replaceDocument: api.replaceDocument, api };
  return null;
}

export const toasts: string[] = [];

/** Render the harness and let the listener's `listen()` promise settle. */
export async function mountPrompt() {
  toasts.length = 0;
  const rendered = render(<Harness />);
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

export type ChangeType = "modified" | "deleted" | "renamed";

/** Deliver one `file:changed` event, as Rust would emit it. */
export function emitChange(path: string, changeType: ChangeType = "modified", extra: Partial<{ newPath: string; timestamp: number }> = {}) {
  act(() => bus.emit("file:changed", { path, changeType, timestamp: extra.timestamp ?? Date.now(), ...extra }));
}

export function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Run `fn` inside act and flush its microtasks. */
export async function flush(fn: () => unknown = () => undefined) {
  await act(async () => {
    await fn();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

export function reloadMessage(): string | null {
  return view.current?.reloadMessage ?? null;
}
