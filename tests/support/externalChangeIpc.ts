/**
 * Purpose: the controllable Tauri `invoke` for the D171 external-change cases.
 * `reload_file`, `save_file`, `close_document` and `open_file` answer from per-test
 * handlers; every other command answers through `fileWatcherLogHarness.coreModule`,
 * so `logLines()` still sees each `log_event`.
 *
 * Kept free of app imports: `vi.mock("@tauri-apps/api/core")` loads it, and an app
 * module here would import the mocked module back and deadlock the mock factory.
 *
 * Key decisions:
 * - Plain functions and module state, reset by `resetExternalChangeHarness()`;
 *   vitest's `clearMocks` never wipes it mid-file.
 * - `deferred()` lets a test hold `reload_file` / `save_file` in flight and settle
 *   it later, which is how the interleavings are driven.
 */
import { coreModule as watcherCore } from "../helpers/fileWatcherLogHarness";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<unknown>;

const handlers = new Map<string, Handler>();
export const ipcCalls: Array<{ cmd: string; args: Args }> = [];

export const coreModule = {
  ...watcherCore,
  invoke: async (cmd: string, args?: Args): Promise<unknown> => {
    const handler = handlers.get(cmd);
    if (!handler) return watcherCore.invoke(cmd, args);
    ipcCalls.push({ cmd, args: args ?? {} });
    return handler(args ?? {});
  },
};

/** Answer `cmd` with `handler` until the next reset. */
export function onIpc(cmd: string, handler: Handler): void {
  handlers.set(cmd, handler);
}

export function ipcCount(cmd: string): number {
  return ipcCalls.filter((c) => c.cmd === cmd).length;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function resetExternalChangeHarness(): void {
  handlers.clear();
  ipcCalls.length = 0;
  onIpc("save_file", async (args) => ({ success: true, path: String(args.path), savedAt: 1_700_000_000_500 }));
  onIpc("close_document", async () => ({ success: true }));
}

