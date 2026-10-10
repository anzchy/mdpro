/**
 * Purpose: a shape-strict stand-in for Rust's `sync_recent_files_menu` session
 * model, for the D43 WI-4 frontend tests (matrix
 * `.claude/tdd-guardian/tests-20261007-143049.md`, "Shared test helper").
 *
 * It is test support, not mocked production code: the session model uses the
 * real TS `pushRecent` / `mergePending` as the reference for the Rust merge.
 *
 * Key decisions:
 * - Strict wire shape. The handler throws `Error("bad op shape")` unless the
 *   args' keys are exactly `{op, viewMode}`, `op` matches one of the three
 *   wire shapes by key set and types, and `viewMode` is `null` for seed and
 *   record and a non-empty string for refresh (Gap 1). A wrong payload makes
 *   the caller fall back to its local list, so payload errors are visible in
 *   the hook's output (Level 5).
 * - `menuViewMode` models `MenuState.last_view_mode`: only a non-null
 *   `viewMode` updates it. `installModes` records the remembered mode at every
 *   answered call.
 * - `answer` overrides the reply (after the shape check) for cases that need a
 *   fixed or malformed response.
 */
import { MAX_RECENT_FILES, mergePending, pushRecent } from "../../src/utils/recentFiles";

export const SYNC_COMMAND = "sync_recent_files_menu";

export type WireOp =
  | { kind: "seed"; stored: string[] | null; pendingNewestFirst: string[] }
  | { kind: "record"; path: string }
  | { kind: "refresh" };

export interface SyncArgs {
  op: WireOp;
  viewMode: string | null;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

const sameKeys = (o: object, keys: string[]) => {
  const actual = Object.keys(o).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((k, i) => k === expected[i]);
};

/** Throws `bad op shape` unless `args` is exactly the pinned wire shape. */
export function assertWireShape(args: unknown): SyncArgs {
  const bad = () => new Error("bad op shape");
  if (typeof args !== "object" || args === null || !sameKeys(args, ["op", "viewMode"])) {
    throw bad();
  }
  const { op, viewMode } = args as { op: unknown; viewMode: unknown };
  if (typeof op !== "object" || op === null) throw bad();
  const o = op as Record<string, unknown>;
  if (o.kind === "seed") {
    if (!sameKeys(o, ["kind", "stored", "pendingNewestFirst"])) throw bad();
    if (!(o.stored === null || isStringArray(o.stored))) throw bad();
    if (!isStringArray(o.pendingNewestFirst)) throw bad();
    if (viewMode !== null) throw bad();
  } else if (o.kind === "record") {
    if (!sameKeys(o, ["kind", "path"]) || typeof o.path !== "string") throw bad();
    if (viewMode !== null) throw bad();
  } else if (o.kind === "refresh") {
    if (!sameKeys(o, ["kind"])) throw bad();
    if (typeof viewMode !== "string" || viewMode === "") throw bad();
  } else {
    throw bad();
  }
  return args as SyncArgs;
}

/** The Rust merge, modelled with the real TS utils. */
export function applyOp(current: readonly string[], op: WireOp): string[] {
  if (op.kind === "record") return pushRecent(current, op.path);
  if (op.kind === "refresh") return [...current];
  const stored = op.stored ?? [];
  const base = [...current, ...stored.filter((p) => !current.includes(p))];
  return mergePending(base, op.pendingNewestFirst).slice(0, MAX_RECENT_FILES);
}

export interface SessionFake {
  session: string[];
  menuViewMode: string | null;
  installModes: (string | null)[];
  /** Every accepted args object, in arrival order. */
  calls: SyncArgs[];
  /** The last reply handed back. */
  lastAnswer: unknown;
  handle: (args: unknown) => unknown;
}

export function createSessionFake(
  options: { answer?: (args: SyncArgs) => unknown } = {},
): SessionFake {
  const fake: SessionFake = {
    session: [],
    menuViewMode: null,
    installModes: [],
    calls: [],
    lastAnswer: undefined,
    handle(raw: unknown) {
      const args = assertWireShape(raw);
      fake.calls.push(args);
      if (args.viewMode !== null) fake.menuViewMode = args.viewMode;
      fake.installModes.push(fake.menuViewMode);
      fake.session = applyOp(fake.session, args.op);
      fake.lastAnswer = options.answer ? options.answer(args) : [...fake.session];
      return fake.lastAnswer;
    },
  };
  return fake;
}
