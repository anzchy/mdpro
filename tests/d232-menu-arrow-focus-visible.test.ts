/**
 * D232: arrow keys in the table context menus (WYSIWYG and Source) moved focus
 * with a plain `.focus()`. The menu is opened by a right-click, and WKWebView
 * does not treat a script focus after a pointer interaction as focus-visible,
 * so the rule 33 ring never showed (Stage 3 batch 5; same mechanism as D53 /
 * D63). Arrow, Home and End now go through `moveMenuFocus`, which asks for
 * `focus({ focusVisible: true })`.
 *
 * jsdom has no `:focus-visible`, so the contract is the focus call's options,
 * plus that both menus route their traversal keys through the helper.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { moveMenuFocus } from "../src/components/Editor/menuItemFocus";

let items: HTMLButtonElement[];
let focusSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = "";
  items = ["a", "b", "c"].map((name) => {
    const b = document.createElement("button");
    b.textContent = name;
    document.body.appendChild(b);
    return b;
  });
  focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
});

afterEach(() => {
  focusSpy.mockRestore();
});

const lastCall = () => ({ el: focusSpy.mock.contexts.at(-1), opts: focusSpy.mock.calls.at(-1)?.[0] });

describe("D232 moveMenuFocus", () => {
  it.each([
    ["ArrowDown", 0, 1],
    ["ArrowDown", 2, 0],
    ["ArrowUp", 1, 0],
    ["ArrowUp", 0, 2],
    ["Home", 2, 0],
    ["End", 0, 2],
  ])("%s from item %i focuses item %i as visible focus", (key, from, to) => {
    items[from].focus();
    focusSpy.mockClear();
    expect(moveMenuFocus(items, key)).toBe(true);
    expect(lastCall().el).toBe(items[to]);
    expect(lastCall().opts).toEqual({ focusVisible: true });
    expect(document.activeElement).toBe(items[to]);
  });

  it("ArrowDown with focus outside the items lands on the first item", () => {
    focusSpy.mockClear();
    expect(moveMenuFocus(items, "ArrowDown")).toBe(true);
    expect(lastCall().el).toBe(items[0]);
    expect(lastCall().opts).toEqual({ focusVisible: true });
  });

  it("other keys are not handled and move nothing", () => {
    items[1].focus();
    focusSpy.mockClear();
    expect(moveMenuFocus(items, "Enter")).toBe(false);
    expect(moveMenuFocus(items, "a")).toBe(false);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("an empty list handles nothing", () => {
    expect(moveMenuFocus([], "ArrowDown")).toBe(false);
  });
});

describe("D232 both table menus use it", () => {
  const ROOT = path.resolve(__dirname, "..");
  const sources = ["TableContextMenu", "SourceTableContextMenu"].map((dir) => [
    dir,
    fs.readFileSync(path.join(ROOT, `src/components/Editor/${dir}/index.tsx`), "utf-8"),
  ]);

  it.each(sources)("%s routes its traversal keys through moveMenuFocus", (_dir, src) => {
    expect(src).toMatch(/moveMenuFocus\(items, event\.key\)/);
  });

  it.each(sources)("%s has no plain item focus left for arrow, Home or End", (_dir, src) => {
    expect(src).not.toMatch(/items\[[^\]]*\]\?\.focus\(\)/);
  });
});

describe("D232 the arrow keys reach the alignment items", () => {
  // The Alignment group's items are role="menuitemradio" (ActionList.tsx). The
  // WYSIWYG menu collected only role="menuitem", so its arrows skipped them;
  // the Source menu already took both.
  const ROOT = path.resolve(__dirname, "..");
  const read = (dir: string) => fs.readFileSync(path.join(ROOT, `src/components/Editor/${dir}/index.tsx`), "utf-8");
  const traversalSelector = (src: string) =>
    src.match(/const items = Array\.from\(\s*menuRef\.current\.querySelectorAll<HTMLElement>\(([\s\S]*?)\),\s*\);/)?.[1] ?? "";

  it.each(["TableContextMenu", "SourceTableContextMenu"])("%s traverses menuitem and menuitemradio", (dir) => {
    const sel = traversalSelector(read(dir));
    expect(sel).toContain('button[role="menuitem"]');
    expect(sel).toContain('button[role="menuitemradio"]');
  });
});
