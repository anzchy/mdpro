/**
 * Purpose: the link between a window's MCP confirmation queue (`useMcpConfirm`) and its
 * startup Recovery prompt (`useRecoveryAdmission`), so Recovery waits while a received
 * MCP request is pending and an MCP request waits while admitted Recovery holds the slot
 * (D241, ADR-0116 Decisions 1, 2 and 4). Split out of `useMcpConfirm.ts` (rule 50 § 6).
 *
 * Key decisions:
 * - **Plain ref objects, not React state**: both sides read them synchronously, in event
 *   handlers and in the admission callback, so neither decides on a stale render.
 * - **One link per window**, created by `useRecoveryAdmission` and passed down to the hook.
 *
 * @module src/hooks/mcpRecoveryLink
 * @coordinates-with src/hooks/useMcpConfirm.ts — writes `pending`, reads `recoverySlot`, fills `republish`
 * @coordinates-with src/hooks/useRecoveryAdmission.ts — reads `pending`, writes `recoverySlot`
 */

/** The D241 link between this queue and startup Recovery (ADR-0116). */
export interface McpRecoveryLink {
  /** True exactly while the queue holds a received request; written by the hook. */
  pending: { current: boolean };
  /** Called after each flip of `pending`. */
  onPendingChange?: () => void;
  /** True while admitted Recovery holds the slot: a head waits as behind a modal. */
  recoverySlot: { current: boolean };
  /** Set by the hook while mounted: publish again (after the slot clears). */
  republish: { current: (() => void) | null };
}

export function createMcpRecoveryLink(): McpRecoveryLink {
  return { pending: { current: false }, recoverySlot: { current: false }, republish: { current: null } };
}
