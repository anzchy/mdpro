# 0099. WYSIWYG list markers are written through a wrapped stock list handler

## Status

Accepted, 2026-10-15. Decided by mdpro-delegator, inside the user's D204 scope (delegator rulings
relayed the same day: the default marker is `-`, and the ordered delimiter `)` is in scope). The
delegator's ruling: "option A … nothing new is downloaded or trusted, because the package is
already in the tree. B drifts silently with no parity test. C breaks the 「`1)` in scope」 ruling
and other markers." Amended before landing, 2026-10-15, for the three findings of audit b131
(delegator: fix them on the branch, and either follow the ADR's default or amend it): the
alternate bullet, the default for nested lists, and the nine-digit numbering limit, in Decision
and Consequences below.

## Context

D204: a WYSIWYG save after an edit rewrote every bullet list with `*` and every ordered list with
`.`, whatever the source used, and two adjacent lists swapped markers. Milkdown builds its
stringifier as `unified().use(remarkStringify, { handlers, encode: [] })` with no list options, so
mdast-util-to-markdown falls back to `bullet: '*'`. Nothing stored the source marker.

Keeping each list's own marker means the `list` handler has to run with that list's bullet. The
forces as understood at the time:

- The stock handler (`mdast-util-to-markdown/lib/handle/list.js`) holds safety switches that must
  survive: it changes the marker when the bullet would read as a thematic break (`* ---`, an empty
  item nested two deep) and when two adjacent lists would otherwise merge (`bulletLastUsed`).
- Milkdown passes custom handlers in `remarkStringifyOptionsCtx.handlers`, and mdast-util-to-markdown's
  `configure()` assigns them over its defaults. A `list` override therefore replaces the stock
  handler, with no way back to it from inside the override.
- mdpro had no direct dependency on mdast-util-to-markdown (pnpm strict layout), and `@milkdown/kit`
  re-exports nothing from it. remark-stringify@11.0.0 resolves mdast-util-to-markdown@2.1.2.
- The `join` hooks run between siblings, which is too late for a list that is its container's first
  child (a document, blockquote or list item starting with a list).

## Options considered

- **A. Promote `mdast-util-to-markdown` to a direct dependency and wrap `defaultHandlers.list`
  (chosen).** The wrapper sets `options.bullet` (or `bulletOrdered`) to the list's recorded marker
  for one call of the stock handler, clears `bulletOther`, and restores all three in `finally`.
  The stock handler still makes every decision, including its safety switches.
- **B. Vendor a copy of the stock list handler** (about 60 lines, MIT, public `State` API only).
  It lost because it drifts silently from upstream on a remark upgrade, and nothing can import the
  original to prove parity, which is the same dependency problem as A.
- **C. Global options only** (`bullet: '-'`, plus `start` for D208, which needs no handler). It lost
  because it fixes only files that use `-`: `+`, `*`, mixed-marker documents and `1)` would still be
  rewritten, against the ruling that `)` is in scope.

## Decision

- `package.json` lists `mdast-util-to-markdown` `^2.1.2`. The lockfile gains one importer entry
  resolving to the 2.1.2 already in the tree; no other resolution moves.
- `src/plugins/milkdown/listSpread/remarkListMarker.ts` reads each list's marker from the source at
  its first item's offset (the pattern of preset-commonmark's `remarkMarker`).
- The list schemas carry it as a `marker` / `delimiter` attr, which round-trips through the DOM.
- `src/plugins/milkdown/listSpread/listMarker.ts` wraps `defaultHandlers.list` and sets the default
  for a list with no recorded marker: `-` and `.`. The default applies per list, so a list with no
  marker nested in a `*`, `+` or `)` list is written `-` or `.`, not with its parent's marker.
- The stock handler still decides **when** to switch a bullet. The wrapper sets **what** it
  switches to (`bulletOther`), so one alternate satisfies both stock rules at once: it is not the
  previous sibling list's bullet (adjacency), and not the thematic-break character when an item
  starts with a break. The stock choice is kept when it is safe; otherwise the remaining bullet,
  `+` when both others are taken. Without this, `- a` followed by a `*` list of `---` saved as two
  `-` lists that merged on reopen (audit b131).
- An ordered list whose last number would pass nine digits (CommonMark's limit) is written with
  every item carrying the start number. A start that itself passes nine digits, which only a
  pasted `<ol start>` can carry, is written from 1.
- `tests/d204-list-marker-handler.test.ts` V1 pins that the copy mdpro imports is the copy
  remark-stringify resolves.

## Consequences

- Lists keep `-` `+` `*` and `.` `)` through an edit and save. Lists built in the editor, pasted as
  HTML or created by an input rule are written with `-` and `.` (previously `*` and `.`), so tests
  that pinned the old default changed with this decision.
- **Costs**:
  - A dependency change: peers run `pnpm install --force --frozen-lockfile --offline` after it
    lands (rule 10).
  - The coupling is real. A Milkdown or remark upgrade that moves remark-stringify to another
    mdast-util-to-markdown makes V1 fail, and the direct pin has to move with it in the same change.
  - The wrapper relies on `state.options` being the live options object read by `checkBullet` /
    `checkBulletOrdered`, which is mdast-util-to-markdown 2.x behaviour, not a documented contract.
- **Kept, deliberately**: the stock marker switches. A `* ---` item is written `- ***`, a changed
  marker but the same structure. Two adjacent lists the user built with the same marker still
  alternate, so they don't merge into one. Where both rules apply, the switch lands on `+`, a
  third marker the source never used.
- A list starting at 999999999 or close to it loses its counting-up numbers on save (`999999999.`
  on every item). The structure and start are kept; the later numbers were never read anyway.
- **Forecloses** nothing. Typed markers (`* ` input rule → `*` list) and the thematic-break, fence
  and setext style rewrites noted in the D204 prep remain separate items.
