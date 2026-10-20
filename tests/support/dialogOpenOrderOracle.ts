/**
 * @module tests/support/dialogOpenOrderOracle
 * Purpose: the independent event-log model for the D42 open-order helper
 * (`src/utils/dialogOpenOrder.ts`), plus the event domain E its property
 * cases enumerate. Used by `tests/dialog-open-order.test.ts` and, if one is
 * ever needed, its `*.slow.test.ts` sibling (ADR-0050).
 *
 * Independence: this file NEVER imports the code under test, not even its
 * types. The id list and the canonical order are restated here, and the test
 * cross-checks them against the module's export, so a drift in either is loud.
 *
 * Gate G0 means there is no `fast-check`: the enumeration is hand-rolled and
 * the only entropy source is `mulberry32` from `tableCorpus.ts`.
 *
 * Model: the state is the list of open ids, in open order.
 * - `open(X)`: appended when X is closed; a no-op re-render when already open.
 * - `reopen(X)`: X is removed if present and appended.
 * - `close(X)`: X is removed.
 * - A snapshot that changes several ids at once applies the closes, then
 *   appends the newly-opened and reopened ids in canonical order.
 *
 * Not a `*.test.ts`, so vitest does not collect it.
 */
export { mulberry32 } from "./tableCorpus";

export type OracleDialogId =
  | "recovery"
  | "reload"
  | "recreate"
  | "encoding"
  | "confirm"
  | "settings"
  | "mcp";

/** Today's App.tsx source order: the tie-break and the closed-slot order. */
export const ORACLE_CANONICAL: readonly OracleDialogId[] = [
  "recovery",
  "reload",
  "recreate",
  "encoding",
  "confirm",
  "settings",
  "mcp",
];

export const NON_MCP_IDS: readonly OracleDialogId[] = ORACLE_CANONICAL.filter(
  (id) => id !== "mcp",
);

/** The constant token every non-MCP slot carries while open (production model). */
export const OPEN_TOKEN = "open";

export type Tokens = Record<OracleDialogId, string | null>;

export const ALL_CLOSED: Readonly<Tokens> = Object.freeze({
  recovery: null,
  reload: null,
  recreate: null,
  encoding: null,
  confirm: null,
  settings: null,
  mcp: null,
});

export type EventKind = "open" | "close" | "reopen";
export interface DomainEvent {
  kind: EventKind;
  id: OracleDialogId;
}

/** Event domain E: 7 ids × 3 kinds = 21 events. */
export const EVENTS: readonly DomainEvent[] = ORACLE_CANONICAL.flatMap((id) =>
  (["open", "close", "reopen"] as const).map((kind) => ({ kind, id })),
);

export const eventLabel = (e: DomainEvent): string => `${e.kind}(${e.id})`;

/** Fresh MCP request ids, never reused within one generator. */
export function freshIds(): () => string {
  let n = 0;
  return () => `r${++n}`;
}

/** Event-log transition for one logical event. */
export function oracleApply(
  order: readonly OracleDialogId[],
  kind: EventKind,
  id: OracleDialogId,
): OracleDialogId[] {
  const without = order.filter((x) => x !== id);
  if (kind === "close") return without;
  if (kind === "open" && order.includes(id)) return [...order];
  return [...without, id];
}

/** One snapshot of an event's expansion, with the oracle order after it. */
export interface ExpandedSnapshot {
  tokens: Tokens;
  oracle: OracleDialogId[];
}

/**
 * Expand a domain event into its snapshots under the production token model:
 * - non-MCP reopen of an open id is two snapshots, `null` then `"open"`;
 * - every other event is exactly one snapshot (possibly a no-op re-render).
 */
export function expandEvent(
  tokens: Readonly<Tokens>,
  order: readonly OracleDialogId[],
  event: DomainEvent,
  fresh: () => string,
): ExpandedSnapshot[] {
  const { kind, id } = event;
  const isOpen = tokens[id] !== null;
  const set = (value: string | null): Tokens => ({ ...tokens, [id]: value });
  if (kind === "close") {
    return [{ tokens: set(null), oracle: oracleApply(order, "close", id) }];
  }
  if (id === "mcp") {
    if (kind === "open" && isOpen) {
      return [{ tokens: { ...tokens }, oracle: oracleApply(order, "open", id) }];
    }
    return [{ tokens: set(fresh()), oracle: oracleApply(order, "reopen", id) }];
  }
  if (kind === "reopen" && isOpen) {
    const closed = oracleApply(order, "close", id);
    const midTokens = set(null);
    return [
      { tokens: midTokens, oracle: closed },
      {
        tokens: { ...midTokens, [id]: OPEN_TOKEN },
        oracle: oracleApply(closed, "open", id),
      },
    ];
  }
  return [{ tokens: set(OPEN_TOKEN), oracle: oracleApply(order, "open", id) }];
}

/**
 * Multi-id snapshot oracle (Case 1.2). `prevOrder` is the event-log state
 * before the snapshot; `mcpFresh` means mcp received a new request id.
 */
export function oracleSnapshot(
  prevOrder: readonly OracleDialogId[],
  next: Readonly<Tokens>,
  mcpFresh: boolean,
): OracleDialogId[] {
  const reopened = (x: OracleDialogId) => x === "mcp" && mcpFresh;
  const persist = prevOrder.filter((x) => next[x] !== null && !reopened(x));
  const appended = ORACLE_CANONICAL.filter(
    (x) => next[x] !== null && (!prevOrder.includes(x) || reopened(x)),
  );
  return [...persist, ...appended];
}
