/**
 * @module listSpread/listMarker
 * Purpose: The writer half of D204. Milkdown builds its stringifier with no list options,
 * so mdast-util-to-markdown wrote every bullet list with `*` and every ordered list with
 * `.`. This wraps the stock `list` handler so a list carrying `mdproMarker` is written
 * with that marker, and sets the default for lists that carry none: `-` and `.`.
 *
 * Pipeline: `listMarkerStringify` puts `bullet` / `bulletOrdered` and the wrapped `list`
 * handler into `remarkStringifyOptionsCtx`. For one call of the stock handler the wrapper
 * sets the list's marker (or the default), the alternate bullet, and for an ordered list
 * whether numbers count up, then restores all of them in `finally`.
 *
 * Key decisions (ADR-0099):
 *   - The stock handler is `defaultHandlers.list` from mdast-util-to-markdown, a direct
 *     dependency at the version remark-stringify resolves. Milkdown's `handlers` option
 *     replaces the stock entry outright, so there is no other way back to it.
 *   - The stock handler still decides when to switch marker: when the bullet would read as
 *     a thematic break, and when two adjacent lists would otherwise merge. The wrapper only
 *     picks what it switches to (`bulletOther`), so that the alternate satisfies both rules
 *     at once: not the previous sibling list's bullet, and not the rule character when an
 *     item starts with a break. It is the stock default when that is safe, else the bullet
 *     left over (`+` when both
 *     others are taken; audit b131).
 *   - A list with no valid recorded marker gets the default, `-` and `.`, even inside a
 *     list that has one, so it never inherits its parent's marker (audit b131).
 *   - CommonMark reads at most nine digits as a list number. An ordered list whose last
 *     number would pass that is written without counting up: every item carries the start,
 *     and later numbers are ignored on read (audit b131).
 *   - Default `-` and `.`: delegator ruling 2026-10-15 under the user's D204 scope.
 *
 * @coordinates-with src/plugins/milkdown/listSpread/remarkListMarker.ts — the reader half
 * @coordinates-with src/plugins/milkdown/listSpread/index.ts — puts `mdproMarker` on the mdast list
 */
import { ConfigReady, initTimerCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { createTimer, type MilkdownPlugin } from "@milkdown/kit/ctx";
import { defaultHandlers, type Handle } from "mdast-util-to-markdown";
import { BULLET_MARKERS, ORDERED_DELIMITERS } from "./remarkListMarker";

/** The marker a list with none from its source is written with. */
export const DEFAULT_BULLET = "-";
export const DEFAULT_ORDERED_DELIMITER = ".";

/** The largest number CommonMark reads as an ordered list marker (nine digits). */
export const MAX_ORDERED_NUMBER = 999_999_999;

type Opts = {
  bullet?: string;
  bulletOther?: string;
  bulletOrdered?: string;
  incrementListMarker?: boolean;
  rule?: string;
};

type ListNode = {
  ordered?: boolean | null;
  start?: number | null;
  mdproMarker?: unknown;
  children?: { type?: string; children?: { type?: string }[] }[];
};

/** Whether any item of the list starts with a thematic break (the stock handler's test). */
function hasLeadingBreak(list: ListNode): boolean {
  return (list.children ?? []).some((item) => item.type === "listItem" && item.children?.[0]?.type === "thematicBreak");
}

/**
 * The bullet the stock handler may switch to, or undefined for its own default
 * (`bullet === "*" ? "-" : "*"`) when that avoids every marker in `avoid`.
 */
export function alternateBullet(bullet: string, avoid: readonly (string | undefined)[]): string | undefined {
  const stock = bullet === "*" ? "-" : "*";
  if (!avoid.includes(stock)) return undefined;
  return ["-", "*", "+"].find((c) => c !== bullet && !avoid.includes(c));
}

/** Whether an ordered list's last number would pass nine digits if numbers count up. */
export function overflowsNumbering(list: ListNode): boolean {
  const start = typeof list.start === "number" && list.start > -1 ? list.start : 1;
  return start + Math.max((list.children?.length ?? 0) - 1, 0) > MAX_ORDERED_NUMBER;
}

/**
 * Wrap a `list` handler so the list's own `mdproMarker`, or the default for its kind, is
 * used for that call only, with a safe alternate bullet and numbering that fits.
 */
export function withListMarker(stock: Handle): Handle {
  return (node, parent, state, info) => {
    const list = node as ListNode;
    const marker = typeof list.mdproMarker === "string" ? list.mdproMarker : null;
    const options = state.options as Opts;
    const saved: Opts = {
      bullet: options.bullet,
      bulletOther: options.bulletOther,
      bulletOrdered: options.bulletOrdered,
      incrementListMarker: options.incrementListMarker,
    };
    if (list.ordered) {
      options.bulletOrdered = marker && ORDERED_DELIMITERS.has(marker) ? marker : DEFAULT_ORDERED_DELIMITER;
      options.incrementListMarker = overflowsNumbering(list) ? false : undefined;
    } else {
      const bullet = marker && BULLET_MARKERS.has(marker) ? marker : DEFAULT_BULLET;
      const avoid: (string | undefined)[] = [];
      if (parent && state.bulletLastUsed) avoid.push(state.bulletLastUsed);
      if (hasLeadingBreak(list)) avoid.push(options.rule || "*");
      options.bullet = bullet;
      options.bulletOther = alternateBullet(bullet, avoid);
    }
    try {
      return stock(node, parent, state, info);
    } finally {
      options.bullet = saved.bullet;
      options.bulletOther = saved.bulletOther;
      options.bulletOrdered = saved.bulletOrdered;
      options.incrementListMarker = saved.incrementListMarker;
    }
  };
}

const ListMarkerStringifyReady = createTimer("ListMarkerStringifyReady");

/** Registers the default markers and the wrapped `list` handler in remark-stringify's options. */
export const listMarkerStringify: MilkdownPlugin = (ctx) => {
  ctx.record(ListMarkerStringifyReady);
  ctx.update(initTimerCtx, (timers) => timers.concat(ListMarkerStringifyReady));
  return async () => {
    await ctx.wait(ConfigReady);
    const current = ctx.get(remarkStringifyOptionsCtx);
    ctx.set(remarkStringifyOptionsCtx, {
      ...current,
      bullet: DEFAULT_BULLET,
      bulletOrdered: DEFAULT_ORDERED_DELIMITER,
      handlers: {
        ...current.handlers,
        list: withListMarker(defaultHandlers.list),
      } as typeof current.handlers,
    });
    ctx.done(ListMarkerStringifyReady);
    return () => {
      ctx.clearTimer(ListMarkerStringifyReady);
    };
  };
};
