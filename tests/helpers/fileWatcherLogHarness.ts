/**
 * Purpose: the Tauri-boundary doubles for the D32 file-change logging tests
 * (WI-5 `useFileWatcher` listener, WI-6 `useFileChangeDecisionLog`).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260926-124422.md`, "Test-only fixtures".
 * Only the three Tauri modules are doubled; `loggingService` and
 * `useLoggingStore` stay real, so a captured `log_event` payload is exactly what
 * the production logging path would send.
 *
 * Wiring, in a test file:
 *   vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
 *   vi.mock("@tauri-apps/api/core", async () => (await import("./helpers/fileWatcherLogHarness")).coreModule);
 *   vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
 *
 * Plain functions, not `vi.fn`, so vitest's `clearMocks` / `restoreMocks` never
 * wipe the recorded state mid-file; `resetHarness()` is the only reset.
 * `coreModule` also spreads `createTauriCoreMock()` so it exports `isTauri`
 * (browser mode, a `vi.fn` — restored to false before every test).
 */
import type { Document } from "../../src/types/document";
import type { LogEntryPayload } from "../../src/types/logging";
import { createTauriCoreMock } from "../support/tauriCoreMock";

type Args = Record<string, unknown>;
type TauriEvent = { event: string; id: number; payload: unknown };
type Handler = (event: TauriEvent) => void;

const handlers = new Map<string, Set<Handler>>();
const invokeCalls: Array<{ cmd: string; args: Args }> = [];
let nextEventId = 1;
let windowThrows = false;
let logEventRejects = false;

export const WINDOW_LABEL = "main";

/** In-memory `listen` bus. Handlers register synchronously, like a resolved Tauri listen. */
export const bus = {
  emit(evt: string, payload: unknown): void {
    const set = handlers.get(evt);
    if (!set) return;
    for (const handler of [...set]) handler({ event: evt, id: nextEventId++, payload });
  },
  /** Live handler count for `evt` — 0 after every subscriber has unlistened. */
  count(evt: string): number {
    return handlers.get(evt)?.size ?? 0;
  },
};

export const eventModule = {
  listen: async (evt: string, handler: Handler): Promise<() => void> => {
    const set = handlers.get(evt) ?? new Set<Handler>();
    handlers.set(evt, set);
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  },
  emit: async (evt: string, payload?: unknown): Promise<void> => {
    bus.emit(evt, payload);
  },
};

export const coreModule = {
  ...createTauriCoreMock(),
  invoke: async (cmd: string, args?: Args): Promise<unknown> => {
    invokeCalls.push({ cmd, args: args ?? {} });
    if (cmd === "log_event" && logEventRejects) throw new Error("log_event rejected (harness)");
    return null;
  },
};

export const windowModule = {
  getCurrentWindow: () => {
    if (windowThrows) throw new Error("getCurrentWindow unavailable (harness)");
    return { label: WINDOW_LABEL };
  },
};

/** Payloads of every `invoke("log_event", {payload})`, in call order, optionally by event name. */
export function logLines(name?: string): LogEntryPayload[] {
  return invokeCalls
    .filter((c) => c.cmd === "log_event")
    .map((c) => c.args.payload as LogEntryPayload)
    .filter((p) => name === undefined || p.event === name);
}

/** Number of `invoke` calls for `cmd`. */
export function invokeCount(cmd: string): number {
  return invokeCalls.filter((c) => c.cmd === cmd).length;
}

export function setWindowThrows(value: boolean): void {
  windowThrows = value;
}

export function setLogEventRejects(value: boolean): void {
  logEventRejects = value;
}

export function resetHarness(): void {
  handlers.clear();
  invokeCalls.length = 0;
  nextEventId = 1;
  windowThrows = false;
  logEventRejects = false;
}

/** A complete `Document`; clean, on disk at `/tmp/b.md` unless overridden. */
export function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    path: "/tmp/b.md",
    content: "# b\n",
    encoding: "utf-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: 1_700_000_000_000,
    fileSize: 4,
    ...overrides,
  };
}
