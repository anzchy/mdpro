# 0082. mdpro patches prosemirror-tables for the overlong-rowspan cell paste

**Status**: Accepted (2026-10-12). Decided by mdpro-delegator and mdpro-a3 on
the Codex review the user asked for (「让 Codex 权衡」), which rejected the
first draft of this record (mdpro ports the insert path) and recommended
this route. The draft was never accepted or committed.

## Context

WYSIWYG table paste goes through prosemirror-tables 1.8.5, which mdpro gets
through `@milkdown/kit` → `@milkdown/prose@7.18.0`, not as a direct
dependency. Prose declares `"prosemirror-tables": "^1.8.1"`; the lockfile
resolves 1.8.5. D142 replaced upstream's `handlePaste` with mdpro's
`pasteAsCells` (`src/plugins/milkdown/table/pasteCells.ts`), which retypes
each pasted row for the host row it lands in and otherwise calls the
library's underscore exports `__pastedCells`, `__clipCells` and
`__insertCells`.

Audits b63 and b68 ([D162](../plans/20260912-frontend-backend-sequencing-order.md#d162))
found pastes of a cell whose rowspan runs past the target that throw
`RangeError: No cell with offset …` before dispatch: nothing lands and the
native paste is not prevented. Codex thread
`01a12dc4-f5f2-7fd2-a00d-e672e192c1fa` reproduced both causes independently,
in `prosemirror-tables@1.8.5/dist/index.js`:

- **(a) `clipCells`** (`:1970-2003`, the line at `:1996`) shrinks a cell that
  sticks out below the new height to `max(1, newHeight - rowspan)` rows
  instead of the `newHeight - row` it has left. Rows below it lose cells; a
  row repeated to fill a taller selection keeps a span past the last row.
- **(b) `insertCells`** (`:2107`) takes its closing CellSelection's corners
  from `TableMap.positionAt` (`:101-111`). That is an insertion position: it
  skips a slot covered from above and returns the next cell in the row, or
  the row's end. The selection comes out a column too wide, or
  `CellSelection` throws.

`dist/index.cjs` carries the same code at the same lines. A wrapper around
`__insertCells` cannot help: (b) throws before it dispatches.

## Options considered

- **Port `clipCells` / `insertCells` into mdpro** (the rejected draft). Lost:
  about 180 lines of unchanged upstream logic (`growTable`, the two isolate
  helpers) become mdpro's to maintain and drift from upstream silently, while
  the port still imports `__clipCells` for the width step, so it buys no
  independence from the internal exports.
- **Keep calling the `__` exports, unpatched.** Lost: the bugs are inside
  them.
- **Vendor all of prosemirror-tables.** Lost: forks the whole package for two
  lines, and a second copy breaks the single prosemirror-tables that
  `@milkdown/prose` re-exports and every table plugin shares.
- **File upstream and wait.** Lost as the fix: there is no release timeline.
  Kept as the exit (below). A fixed release inside Prose's `^1.8.1` range can
  be taken by re-resolving the lockfile, without waiting for Milkdown.
- **Accept the defect, or refuse such pastes.** Lost: a real web table pasted
  over selected cells throws and pastes nothing; refusing gives up a merged-
  cell paste that should work.

## Decision

An exact-version pnpm patch, `patches/prosemirror-tables@1.8.5.patch`,
registered under `pnpm.patchedDependencies` in `package.json` (where
pnpm 10.26.1's `patch-commit` writes it) and in `pnpm-lock.yaml`. It changes
two lines in each of `dist/index.js` and `dist/index.cjs`: (a) clips to
`Math.max(1, newHeight - row)`, and (b) takes the corners from
`map.map[top * map.width + left]` and
`map.map[(bottom - 1) * map.width + right - 1]`, the cells that actually
cover the corner slots. `pasteAsCells` stays the adapter and keeps calling
`__clipCells` / `__insertCells`.

Each bug has its own reproduction calling the export directly
(`tests/d162-upstream-clipcells-rowspan.test.ts`,
`tests/d162-upstream-insertcells-selection.test.ts`); reverting either hunk
fails its own file and leaves the other green.
`tests/d162-overlong-rowspan-paste.test.ts` drives the real paste listener.
`tests/d162-prosemirror-tables-patch-guard.test.ts` checks that the copy
resolved through `@milkdown/prose` is 1.8.5, carries both fixes in both entry
points, and that the patch is registered.

## Consequences

- **Gained:** the paste lands, selects exactly the target and leaves the rest
  of the table alone. The unchanged helpers stay upstream's.
- **Cost: the patch is rebased on every change of the resolved version.**
  pnpm fails install on a patch that is unused (`allowUnusedPatches` is
  false by default) or does not apply, so a version move is loud, not silent.
  But a patch that still applies can be semantically stale; the tests are the
  check.
- **Cost: pnpm's unused-patch error is not a full guard.** If another package
  kept a patched 1.8.5 while Milkdown resolved a newer, unpatched copy, the
  patch would still count as used. The guard test covers that case.
- **Cost: both entry points must be patched.** Vite and vitest load the ESM
  `index.js`; `index.cjs` is patched too so no `require` path runs the bug.
- **Cost: mdpro still depends on `__`-prefixed internal exports**, as it has
  since D142. Upstream may rename or drop them in any release.
- **Exit:** an upstream issue and PR with both fixes (owner: mdpro-a3 on
  behalf of the maintainer; upstream issue: to be filed). **Removal
  criterion:** a prosemirror-tables release containing both fixes is what
  `@milkdown/prose` resolves. Then delete the patch, its `patchedDependencies`
  entries and the guard test; the three behaviour tests stay.
