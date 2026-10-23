/** GFM with table Tab navigation retained and app Indent/Outdent keys released. */
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { gfm, strikethroughKeymap, tableKeymap } from "@milkdown/kit/preset/gfm";

const releaseTableModBrackets: MilkdownPlugin = (ctx) => {
  ctx.update(tableKeymap.key, (entries) => ({
    ...entries,
    NextCell: { ...entries.NextCell, shortcuts: "Tab" },
    PrevCell: { ...entries.PrevCell, shortcuts: "Shift-Tab" },
  }));
  return () => {};
};

export const mdproGfm: MilkdownPlugin[] = gfm.flatMap((plugin) => {
  // The app's applied Strike keymap owns this command, including unassignment.
  if (plugin === strikethroughKeymap.shortcuts) return [];
  if (plugin === tableKeymap.shortcuts) return [releaseTableModBrackets, plugin];
  return [plugin];
});
