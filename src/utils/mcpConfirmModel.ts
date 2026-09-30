/**
 * Purpose: the pure TS model of the ADR-0042 in-window MCP write confirmation —
 * the wire domains, strict guards for the `mcp:confirm_request` and
 * `mcp:confirm_resolved` payloads, and the user-facing prompt text.
 *
 * Key decisions:
 * - **Domain lists are the source of their unions** and are pinned to
 *   `tests/fixtures/mcp-confirm-contract.json`, which the Rust payload tests read
 *   too. A Rust enum that grows without these lists following fails CT-1.
 * - **Strict guards, null on anything malformed.** An event payload crosses a
 *   trust boundary, so `confirmRequestOf` checks every field: non-empty ids, a
 *   string title (empty allowed), a known operation, a known table action when
 *   the operation is `table`, and a finite non-negative `expiresInMs` (0 is a
 *   prompt shown at its last millisecond, still valid). Accepted input keeps
 *   exactly the contract fields: unknown keys and a stray non-table `action` are
 *   dropped rather than passed through.
 * - **The message names the document by title only**, never by `documentId` or
 *   `requestId`: ids mean nothing to the user and must not leak into the UI. The
 *   text is distinct per operation and per table action, so the user can tell an
 *   insert from a full replacement.
 *
 * @module src/utils/mcpConfirmModel
 * @coordinates-with src-tauri/src/services/mcp_confirm/payload.rs — the Rust payload shapes
 * @coordinates-with src/services/mcpConfirmService.ts — returns `McpConfirmVerdict`
 * @coordinates-with tests/fixtures/mcp-confirm-contract.json — the shared contract
 */

/** Every operation Rust's `Operation` serialises to. */
export const MCP_CONFIRM_OPERATIONS = ["replace", "insert", "table"] as const;
export type McpConfirmOperation = (typeof MCP_CONFIRM_OPERATIONS)[number];

/** Every table action Rust's `TableAction` serialises to (snake_case). */
export const MCP_CONFIRM_TABLE_ACTIONS = [
  "insert_table",
  "set_cell",
  "add_row",
  "delete_row",
  "add_column",
  "delete_column",
] as const;
export type McpConfirmTableAction = (typeof MCP_CONFIRM_TABLE_ACTIONS)[number];

/** Every `mcp:confirm_resolved` outcome, including `withdrawn` (Revision 1). */
export const MCP_CONFIRM_OUTCOMES = [
  "approved",
  "rejected",
  "timedOut",
  "cancelled",
  "withdrawn",
] as const;
export type McpConfirmOutcome = (typeof MCP_CONFIRM_OUTCOMES)[number];

/** Every verdict `mcp_confirm_reply` returns. */
export const MCP_CONFIRM_VERDICTS = [
  "resolved",
  "ignoredUnknown",
  "ignoredWrongWindow",
  "ignoredNotShown",
] as const;
export type McpConfirmVerdict = (typeof MCP_CONFIRM_VERDICTS)[number];

/** A parsed `mcp:confirm_request`. `action` is present iff `operation` is `table`. */
export interface ConfirmRequest {
  requestId: string;
  documentId: string;
  documentTitle: string;
  operation: McpConfirmOperation;
  action?: McpConfirmTableAction;
  expiresInMs: number;
}

/** A parsed `mcp:confirm_resolved`. */
export interface ConfirmResolved {
  requestId: string;
  outcome: McpConfirmOutcome;
}

type Fields = Record<string, unknown>;

function asObject(payload: unknown): Fields | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  return payload as Fields;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMember<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Parse an `mcp:confirm_request` payload; `null` when any field is malformed. */
export function confirmRequestOf(payload: unknown): ConfirmRequest | null {
  const p = asObject(payload);
  if (!p) return null;
  const { requestId, documentId, documentTitle, operation, action, expiresInMs } = p;
  if (!isNonEmptyString(requestId) || !isNonEmptyString(documentId)) return null;
  if (typeof documentTitle !== "string") return null;
  if (!isMember(MCP_CONFIRM_OPERATIONS, operation)) return null;
  if (typeof expiresInMs !== "number" || !Number.isFinite(expiresInMs) || expiresInMs < 0) {
    return null;
  }
  const base = { requestId, documentId, documentTitle, operation };
  if (operation !== "table") return { ...base, expiresInMs };
  if (!isMember(MCP_CONFIRM_TABLE_ACTIONS, action)) return null;
  return { ...base, action, expiresInMs };
}

/** Parse an `mcp:confirm_resolved` payload; `null` on a bad id or unknown outcome. */
export function confirmResolvedOf(payload: unknown): ConfirmResolved | null {
  const p = asObject(payload);
  if (!p) return null;
  const { requestId, outcome } = p;
  if (!isNonEmptyString(requestId) || !isMember(MCP_CONFIRM_OUTCOMES, outcome)) return null;
  return { requestId, outcome };
}

const TABLE_PHRASES: Record<McpConfirmTableAction, string> = {
  insert_table: "add a new table to",
  set_cell: "change a table cell in",
  add_row: "add a table row to",
  delete_row: "delete a table row from",
  add_column: "add a table column to",
  delete_column: "delete a table column from",
};

function phraseOf(req: ConfirmRequest): string {
  switch (req.operation) {
    case "replace":
      return "replace all of the content of";
    case "insert":
      return "add content to";
    case "table":
      return req.action ? TABLE_PHRASES[req.action] : "change a table in";
  }
}

/**
 * The prompt text for a request: what the MCP client wants to do, naming the
 * document by title only. Never contains `documentId` or `requestId`.
 */
export function confirmMessage(req: ConfirmRequest): string {
  return `An MCP client wants to ${phraseOf(req)} “${req.documentTitle}”.`;
}
