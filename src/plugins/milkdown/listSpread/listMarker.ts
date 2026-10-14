/**
 * @module listSpread/listMarker
 * Purpose: The writer half of D204. Milkdown builds its stringifier with no list options,
 * so mdast-util-to-markdown wrote every bullet list with `*` and every ordered list with
 * `.`. This wraps the stock `list` handler so a list carrying `mdproMarker` is written
 * with that marker, and sets the default for lists that carry none: `-` and `.`.
 *
 * Pipeline: `listMarkerStringify` puts `bullet` / `bulletOrdered` and the wrapped `list`
 * handler into `remarkStringifyOptionsCtx`. The wrapper sets `options.bullet` (or
 * `bulletOrdered`) for one call of the stock handler and restores it in `finally`.
 *
 * Key decisions (ADR-0099):
 *   - The stock handler is `defaultHandlers.list` from mdast-util-to-markdown, a direct
 *     dependency at the version remark-stringify resolves. Milkdown's `handlers` option
 *     replaces the stock entry outright, so there is no other way back to it.
 *   - The stock handler still decides, so its safety switches are kept: a different
 *     marker when the bullet would read as a thematic break, and when two adjacent
 *     lists would otherwise merge. `bulletOther` is cleared for a marked list, because
 *     it must differ from the bullet; the stock default then picks the other one.
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

type Opts = { bullet?: string; bulletOther?: string; bulletOrdered?: string };

/** Wrap a `list` handler so the list's own `mdproMarker` is used for that call only. */
export function withListMarker(stock: Handle): Handle {
  return (node, parent, state, info) => {
    const list = node as { ordered?: boolean | null; mdproMarker?: unknown };
    const marker = typeof list.mdproMarker === "string" ? list.mdproMarker : null;
    const options = state.options as Opts;
    const saved: Opts = {
      bullet: options.bullet,
      bulletOther: options.bulletOther,
      bulletOrdered: options.bulletOrdered,
    };
    if (marker && list.ordered && ORDERED_DELIMITERS.has(marker)) {
      options.bulletOrdered = marker;
    } else if (marker && !list.ordered && BULLET_MARKERS.has(marker)) {
      options.bullet = marker;
      options.bulletOther = undefined;
    }
    try {
      return stock(node, parent, state, info);
    } finally {
      options.bullet = saved.bullet;
      options.bulletOther = saved.bulletOther;
      options.bulletOrdered = saved.bulletOrdered;
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
