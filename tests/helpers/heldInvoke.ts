/**
 * Purpose: a deferred-promise `invoke` double for the D19 save-race tests. It lets a test
 * hold a Tauri command (`save_file`, `save_file_dialog`, `get_preferences`) open, land a
 * second write in the store while the save is awaiting, and then release the command.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-232521-d19.md` §1. Frozen with the D19 WI-1
 * red receipt; WI-4 must go green without editing it.
 *
 * Load-bearing mechanics (§1.2):
 * 1. Every call is recorded synchronously, before anything else happens.
 * 2. A held command's entry is pushed inside the Promise executor (synchronous), and only
 *    then are `whenCalled` waiters notified, so `release` right after `await whenCalled`
 *    always finds the entry.
 * 3. An unheld command resolves with its auto-reply. An auto-reply that returns a Promise
 *    is adopted.
 * 4. `release` / `fail` throw when nothing is pending, so a mis-sequenced test fails loudly.
 */
import type { Mock } from "vitest";

export const SAVED_AT = 1_700_000_000_000;
export const A_PATH = "/tmp/a.md";
export const DIALOG_PATH = "/tmp/chosen.md";

type Args = Record<string, unknown>;
type Pending = { args: Args; resolve: (v: unknown) => void; reject: (e: unknown) => void };
type Waiter = { n: number; resolve: (args: Args) => void };

export interface HeldInvoke {
  hold(...cmds: string[]): void;
  reply(cmd: string, fn: (args: Args) => unknown): void;
  whenCalled(cmd: string, n?: number, timeoutMs?: number): Promise<Args>;
  release(cmd: string, value: unknown): void;
  fail(cmd: string, error: unknown): void;
  pendingCount(cmd: string): number;
  calls(cmd: string): Args[];
  assertDrained(): void;
}

const DEFAULT_WHEN_CALLED_TIMEOUT_MS = 2000;

function defaultReplies(): Record<string, (args: Args) => unknown> {
  return {
    get_preferences: () => ({ markdown: { autoReformatTablesOnSave: false } }),
    save_file: (args) => ({ success: true, path: args.path, savedAt: SAVED_AT }),
    save_file_dialog: () => ({ success: true, path: DIALOG_PATH, savedAt: SAVED_AT }),
    delete_draft: () => true,
    close_document: () => null,
  };
}

export function createHeldInvoke(invokeMock: Mock): HeldInvoke {
  const held = new Set<string>();
  const replies = defaultReplies();
  const queues: Record<string, Pending[]> = {};
  const recorded: Array<{ cmd: string; args: Args }> = [];
  const waiters: Record<string, Waiter[]> = {};

  const callsOf = (cmd: string): Args[] =>
    recorded.filter((c) => c.cmd === cmd).map((c) => c.args);

  const notify = (cmd: string) => {
    const seen = callsOf(cmd);
    const list = waiters[cmd] ?? [];
    waiters[cmd] = list.filter((w) => {
      if (seen.length < w.n) return true;
      w.resolve(seen[w.n - 1]);
      return false;
    });
  };

  invokeMock.mockImplementation((cmd: string, args: Args = {}) => {
    recorded.push({ cmd, args });
    if (held.has(cmd)) {
      const promise = new Promise((resolve, reject) => {
        (queues[cmd] ??= []).push({ args, resolve, reject });
      });
      notify(cmd);
      return promise;
    }
    notify(cmd);
    const fn = replies[cmd];
    return Promise.resolve(fn ? fn(args) ?? null : null);
  });

  const take = (cmd: string, verb: string): Pending => {
    const entry = queues[cmd]?.shift();
    if (!entry) throw new Error(`${verb}(${cmd}): no pending call`);
    return entry;
  };

  return {
    hold(...cmds) {
      for (const c of cmds) held.add(c);
    },
    reply(cmd, fn) {
      replies[cmd] = fn;
    },
    whenCalled(cmd, n = 1, timeoutMs = DEFAULT_WHEN_CALLED_TIMEOUT_MS) {
      const seen = callsOf(cmd);
      if (seen.length >= n) return Promise.resolve(seen[n - 1]);
      return new Promise<Args>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters[cmd] = (waiters[cmd] ?? []).filter((w) => w !== waiter);
          reject(new Error(`${cmd} was never invoked (wanted call #${n}) within ${timeoutMs}ms`));
        }, timeoutMs);
        const waiter: Waiter = {
          n,
          resolve: (args) => {
            clearTimeout(timer);
            resolve(args);
          },
        };
        (waiters[cmd] ??= []).push(waiter);
      });
    },
    release(cmd, value) {
      take(cmd, "release").resolve(value);
    },
    fail(cmd, error) {
      take(cmd, "release").reject(error);
    },
    pendingCount(cmd) {
      return queues[cmd]?.length ?? 0;
    },
    calls(cmd) {
      return callsOf(cmd);
    },
    assertDrained() {
      const left = Object.entries(queues).filter(([, q]) => q.length > 0);
      for (const [, q] of left) q.length = 0;
      if (left.length > 0) {
        throw new Error(
          `held invoke not drained: ${left.map(([c]) => c).join(", ")} still pending`,
        );
      }
    },
  };
}
