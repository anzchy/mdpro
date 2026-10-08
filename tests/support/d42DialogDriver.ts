/**
 * @module tests/support/d42DialogDriver
 * Purpose: the shared domain for the D42 WI-4 `AppDialogs` open-order cases
 * (`tests/d42-app-dialog-open-order.test.tsx` and its `.slow.test.tsx` sibling,
 * ADR-0050; matrix `.claude/tdd-guardian/tests-20261008-131500.md` § WI-4). It
 * drives a domain event through the real harness one snapshot at a time and
 * hands each snapshot's oracle order to a checker, plus the two invariant
 * projections the cases share:
 * - Law (b), the removal invariant (Case 4.8): a removed DOM node that holds a
 *   `role="dialog"` card must belong to a dialog that is closed after the step,
 *   except the MCP card on a step that changed its `requestId` while open.
 * - Law (d), the `ui.dialog.stack` projection (Case 4.14): one `{ order }` per
 *   step whose oracle order changed and has two or more ids.
 *
 * Independence: expected orders come from `dialogOpenOrderOracle.ts`, never from
 * `src/utils/dialogOpenOrder.ts`. Not a `*.test.ts`, so vitest does not collect it.
 */
import {
  oracleApply,
  type DomainEvent,
  type OracleDialogId,
} from "./dialogOpenOrderOracle";
import {
  DIALOG_NAME,
  HARNESS_DIALOG_IDS,
  type AppDialogsHarness,
  type HarnessDialogId,
} from "./appDialogsHarness";

/** One snapshot a domain event produced, as the checker sees it. */
export interface DriverStep {
  /** The event-log oracle's open order after this snapshot. */
  oracle: OracleDialogId[];
  /** The oracle order before this snapshot. */
  before: OracleDialogId[];
  /** True when this snapshot replaced the shown MCP request while MCP stayed open. */
  mcpTokenChanged: boolean;
}

/**
 * Apply one domain event through the harness under the production token model.
 * A non-MCP reopen of an open id is two snapshots (close, then open), and the
 * checker runs after each one, including the intermediate close.
 */
export async function applyDomainEvent(
  h: AppDialogsHarness,
  order: readonly OracleDialogId[],
  event: DomainEvent,
  check: (step: DriverStep) => Promise<void> | void,
): Promise<OracleDialogId[]> {
  const { kind, id } = event;
  const isOpen = order.includes(id);
  if (kind === "reopen" && id !== "mcp" && isOpen) {
    await h.close(id);
    const closed = oracleApply(order, "close", id);
    await check({ oracle: closed, before: [...order], mcpTokenChanged: false });
    await h.open(id);
    const reopened = oracleApply(closed, "open", id);
    await check({ oracle: reopened, before: closed, mcpTokenChanged: false });
    return reopened;
  }
  if (kind === "open") await h.open(id);
  else if (kind === "close") await h.close(id);
  else await h.reopen(id);
  const next = oracleApply(order, kind === "reopen" && !isOpen ? "open" : kind, id);
  const mcpTokenChanged = id === "mcp" && kind === "reopen" && isOpen;
  await check({ oracle: next, before: [...order], mcpTokenChanged });
  return next;
}

/** The accessible name of a (possibly detached) dialog card. */
function cardName(card: Element): string {
  const label = card.getAttribute("aria-label");
  if (label) return label;
  const labelledBy = card.getAttribute("aria-labelledby");
  if (!labelledBy) return "";
  const byId = (root: Element) =>
    [...root.querySelectorAll("[id]")].find((el) => el.id === labelledBy);
  return (byId(card) ?? card.ownerDocument.getElementById(labelledBy))?.textContent ?? "";
}

function idOfCard(card: Element): HarnessDialogId | null {
  const name = cardName(card).trim();
  for (const id of HARNESS_DIALOG_IDS) {
    const want = DIALOG_NAME[id];
    if (typeof want === "string" ? want === name : want.test(name)) return id;
  }
  return null;
}

/** The dialog ids whose card was inside (or was) a node these records removed. */
export function removedDialogIds(records: readonly MutationRecord[]): HarnessDialogId[] {
  const out: HarnessDialogId[] = [];
  for (const record of records) {
    for (const node of record.removedNodes) {
      if (!(node instanceof Element)) continue;
      const cards = node.matches('[role="dialog"]')
        ? [node]
        : [...node.querySelectorAll('[role="dialog"]')];
      for (const card of cards) {
        const id = idOfCard(card);
        out.push(id ?? (`unknown:${cardName(card)}` as HarnessDialogId));
      }
    }
  }
  return out;
}

/**
 * Law (b): removed dialog cards that belong to a dialog still open after the
 * step. The one permitted exception is MCP on a step that changed its token.
 */
export function offendingRemovals(
  records: readonly MutationRecord[],
  openAfter: readonly OracleDialogId[],
  mcpTokenChanged: boolean,
): HarnessDialogId[] {
  return removedDialogIds(records).filter((id) => {
    if (id === "mcp" && mcpTokenChanged) return false;
    return (openAfter as readonly string[]).includes(id);
  });
}

/** Law (d): the stack line one step should add, or none. */
export function stackProjection(
  before: readonly OracleDialogId[],
  after: readonly OracleDialogId[],
): Array<{ order: OracleDialogId[] }> {
  const changed = before.length !== after.length || before.some((id, i) => after[i] !== id);
  return changed && after.length >= 2 ? [{ order: [...after] }] : [];
}

/**
 * A childList observer on `root`; `drain()` returns and clears every record
 * since the last drain. The callback keeps what it is delivered: an `await`
 * lets the observer's microtask hand pending records to the callback, after
 * which `takeRecords()` alone would no longer return them.
 */
export function watchRemovals(root: Node): { drain: () => MutationRecord[]; stop: () => void } {
  const seen: MutationRecord[] = [];
  const observer = new MutationObserver((records) => void seen.push(...records));
  observer.observe(root, { childList: true, subtree: true });
  const drain = () => seen.splice(0, seen.length).concat(observer.takeRecords());
  return { drain, stop: () => observer.disconnect() };
}
