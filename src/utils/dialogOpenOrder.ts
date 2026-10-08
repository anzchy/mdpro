/**
 * @module src/utils/dialogOpenOrder
 * Purpose: the pure open-order model for the six App-level dialogs (D42).
 * Given the previous open order and this render's per-dialog open tokens, it
 * returns the next open order; `dialogRenderOrder` turns that into the slot
 * order to render, so the most recently opened dialog paints last (on top).
 *
 * Key decisions (ADR-0062, written in D42 WI-5):
 * - All six dialogs follow open order; MCP is not pinned on top. A covered MCP
 *   prompt can time out unseen, which ADR-0062 records as the cost.
 * - Tokens: `null` (or a missing key) means closed; any other string, including
 *   `""`, means open. An id whose token differs from the one carried for it
 *   counts as a reopen and moves to the end. Non-MCP slots pass the constant
 *   `"open"`, so they re-raise only after a closed render; MCP passes its
 *   `requestId`, so a queued replacement re-raises without one.
 * - Carry-token API shape: `prev` is `readonly OpenDialogEntry[]` (`{ id, token }`
 *   in open order) and the result has the same shape, so the output feeds
 *   straight back in. Only open ids are carried: a closed id's token is
 *   forgotten, so a reopen that reuses the same token is still a reopen.
 * - Ids that persist (still open, same token) keep their relative order; ids
 *   that open or reopen in the same snapshot are appended in canonical order.
 * - Malformed `prev`: unknown ids are dropped and, for a duplicated id, the
 *   first occurrence wins. Re-applying the result with the same tokens returns
 *   an equal result (idempotent), which is what makes it safe under a
 *   StrictMode double render. Inputs are never mutated.
 * - Closed-after-open layout: `dialogRenderOrder` renders the open ids first,
 *   in open order, then every closed slot in `APP_DIALOG_CANONICAL_ORDER`. A
 *   dialog that is just opening therefore already renders after every open
 *   dialog, even in the render before the open order catches up, and open
 *   dialogs never move relative to one another except on a deliberate reopen.
 * - Pure: no React, no DOM, no logging (tests run under the node environment,
 *   ADR-0049).
 */

/** The closed set of App-level dialog slots. */
export type AppDialogId =
  | "recovery"
  | "reload"
  | "encoding"
  | "confirm"
  | "settings"
  | "mcp";

/** Today's App.tsx source order: the tie-break and the closed-slot order. */
export const APP_DIALOG_CANONICAL_ORDER: readonly AppDialogId[] = [
  "recovery",
  "reload",
  "encoding",
  "confirm",
  "settings",
  "mcp",
];

/** Per-slot open token for one render: `null` = closed. */
export type AppDialogTokens = Readonly<Record<AppDialogId, string | null>>;

/** One open dialog in the carried open order, with the token it opened with. */
export interface OpenDialogEntry {
  readonly id: AppDialogId;
  readonly token: string;
}

const KNOWN_IDS: ReadonlySet<string> = new Set(APP_DIALOG_CANONICAL_ORDER);

function isAppDialogId(id: unknown): id is AppDialogId {
  return typeof id === "string" && KNOWN_IDS.has(id);
}

/**
 * Next open order: persisting entries in their previous relative order, then
 * every newly opened or reopened id in canonical order. Never mutates inputs.
 */
export function nextDialogOpenOrder(
  prev: readonly OpenDialogEntry[],
  tokens: AppDialogTokens,
): OpenDialogEntry[] {
  const seen = new Set<AppDialogId>();
  const persisting: OpenDialogEntry[] = [];
  for (const entry of prev) {
    if (!isAppDialogId(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (tokens[entry.id] === entry.token) persisting.push(entry);
  }
  const kept = new Set(persisting.map((entry) => entry.id));
  const appended: OpenDialogEntry[] = [];
  for (const id of APP_DIALOG_CANONICAL_ORDER) {
    const token = tokens[id];
    if (token != null && !kept.has(id)) appended.push({ id, token });
  }
  return [...persisting, ...appended];
}

/**
 * Render order (closed-after-open): the open ids in the given order, then the
 * remaining slots in canonical order. Unknown and repeated ids are ignored, so
 * the result is always a permutation of all six slots.
 */
export function dialogRenderOrder(openOrder: readonly AppDialogId[]): AppDialogId[] {
  const open = [...new Set(openOrder)].filter(isAppDialogId);
  const closed = APP_DIALOG_CANONICAL_ORDER.filter((id) => !open.includes(id));
  return [...open, ...closed];
}
