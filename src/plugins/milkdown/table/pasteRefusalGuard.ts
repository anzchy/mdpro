/**
 * @module table/pasteRefusalGuard
 * Purpose: Refuses a table-carrying paste inside a table that would split the host
 * table (D83) or be dropped by a CellSelection (D136), before any other plugin's
 * `handlePaste` sees it.
 *
 * Pipeline: paste → `transformPasted` → `handlePaste` (this plugin, FIRST in the
 * plugin list: `pasteRefusal` → `refuseTableBreak`) → the cell paste
 * (`pasteWidenAlignment.ts` → `pasteCells.ts`, also at the front) → gfm's
 * `tableEditing` → `replaceSelection`.
 *
 * Key decisions:
 *   - Registered at the FRONT of `prosePluginsCtx`, not appended like `$prose`.
 *     `someProp("handlePaste")` asks plugins in order and stops at the first true,
 *     and gfm's `tableEditing` — registered before the parity list — consumes
 *     every paste over a CellSelection. An appended handler never saw that case,
 *     which is how D136 slipped past D83's refusal.
 *   - The decision and the refusal live in `pasteTableNormalize.ts`
 *     (`pasteRefusal`, `refuseTableBreak`) beside the drop refusal and the copy
 *     table; this file only puts them first. A paste it lets through is untouched
 *     and logs nothing.
 *   - Its only prop is `handlePaste`, so being first changes nothing else.
 *
 * @coordinates-with src/plugins/milkdown/table/pasteTableNormalize.ts — decision, copy, logging
 * @coordinates-with src/plugins/milkdown/table/parityPlugins.ts — registration
 */
import { prosePluginsCtx, SchemaReady } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { pasteRefusal, refuseTableBreak } from "./pasteTableNormalize";

function createPasteRefusalGuard(): Plugin {
  return new Plugin({
    key: new PluginKey("MDPRO_TABLE_PASTE_REFUSAL_GUARD"),
    props: {
      handlePaste: (view, _event, slice) => {
        const refusal = pasteRefusal(view.state, slice);
        return refusal ? refuseTableBreak(refusal, slice) : false;
      },
    },
  });
}

/**
 * The Milkdown plugin. Unlike `$prose`, it puts its ProseMirror plugin at the front
 * of `prosePluginsCtx`, so its `handlePaste` runs before prosemirror-tables'.
 */
export const tablePasteRefusalGuardPlugin: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady);
  const plugin = createPasteRefusalGuard();
  ctx.update(prosePluginsCtx, (plugins) => [plugin, ...plugins]);
  return () => {
    ctx.update(prosePluginsCtx, (plugins) => plugins.filter((p) => p !== plugin));
  };
};
