/**
 * Purpose: keyboard traversal for the table context menus (WYSIWYG and
 * Source): ArrowDown / ArrowUp wrap, Home / End jump.
 *
 * Key decisions:
 * - **Every move is a visible focus request**, `focus({ focusVisible: true })`
 *   (D232). The menus open on a right-click, and WKWebView does not treat a
 *   script focus after a pointer interaction as focus-visible, so a plain
 *   `.focus()` moved focus with no rule 33 ring. Same mechanism as D53 / D63
 *   (`src/hooks/useVisibleInitialFocus.ts`).
 * - The first-item focus on open stays a plain `.focus()`: the menu was opened
 *   with the mouse, so no ring until the keyboard is used.
 * - Enter / Space activation stays with each menu, since their item selectors
 *   differ (the Source menu also has `menuitemradio`).
 *
 * @coordinates-with src/components/Editor/TableContextMenu/index.tsx
 * @coordinates-with src/components/Editor/SourceTableContextMenu/index.tsx
 */

/** `focusVisible` is not in this TS lib.dom yet; WebKit honours it (D53). */
const VISIBLE_FOCUS: FocusOptions & { focusVisible?: boolean } = { focusVisible: true };

/**
 * Moves focus among `items` for a traversal key. Returns whether `key` was one
 * (the caller then calls `preventDefault`). With focus outside the items,
 * ArrowDown goes to the first and ArrowUp to the last.
 */
export function moveMenuFocus(items: HTMLElement[], key: string): boolean {
  if (items.length === 0) return false;
  const idx = items.findIndex((el) => el === document.activeElement);
  let next: number;
  if (key === "ArrowDown") next = (idx + 1 + items.length) % items.length;
  else if (key === "ArrowUp") next = idx === -1 ? items.length - 1 : (idx - 1 + items.length) % items.length;
  else if (key === "Home") next = 0;
  else if (key === "End") next = items.length - 1;
  else return false;
  items[next].focus(VISIBLE_FOCUS);
  return true;
}
