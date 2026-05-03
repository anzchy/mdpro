/**
 * @module SourceTableContextMenu
 * Purpose: Right-click context menu for tables in source mode (Phase 2
 * WI-2.4). Mirrors the WYSIWYG `TableContextMenu` (WI-1.3) but operates
 * on a CodeMirror `EditorView` instead of a ProseMirror view.
 *
 * Layered architecture:
 *   - This file: DOM listener (`#source-container`), menu open/close
 *     lifecycle, position clamping, action dispatch with try/catch.
 *   - `ActionList` (reused from `TableContextMenu/`): pure
 *     presentational — renders the grouped action list.
 *   - `getTableActions` (reused from
 *     `plugins/milkdown/table/contextMenu.ts`): pure logic that derives
 *     the per-cell action list from a `TableContext`.
 *   - `sourceTableContextMenu.ts`: the CodeMirror-side dispatcher
 *     (`computeSourceTableContext` + `dispatchSourceTableAction`).
 *
 * Bail rules:
 *   - Right-click outside the source-container DOM → ignored.
 *   - Right-click inside the container but not on a `.cm-line` → ignored.
 *   - Right-click in a `.cm-line` outside any table → ignored (default
 *     browser context menu still suppressed; no menu opens).
 *   - Right-click inside a fenced code block → ignored (fence guard).
 *
 * @coordinates-with src/plugins/codemirror/sourceTableContextMenu.ts
 * @coordinates-with src/components/Editor/TableContextMenu/ActionList
 * @coordinates-with src/stores/editorStore.ts
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeSourceTableContext,
  dispatchSourceTableAction,
} from "../../../plugins/codemirror/sourceTableContextMenu";
import { getTableActions } from "../../../plugins/milkdown/table/contextMenu";
import type {
  TableAction,
  TableActionId,
  TableContext,
} from "../../../plugins/milkdown/table/actionDescriptors";
import { useEditorStore } from "../../../stores/editorStore";
import { loggingService } from "../../../services/loggingService";
import { ActionList } from "../TableContextMenu/ActionList";

interface MenuState {
  /** Viewport coordinates (clamped to fit on screen). */
  x: number;
  y: number;
  /** Source offset that was right-clicked — re-parsed fresh on dispatch. */
  pos: number;
  /** Snapshot at menu-open, used only to render is-active / is-disabled. */
  context: TableContext;
}

const MENU_WIDTH = 220;
const MENU_HEIGHT_MAX = 480;
const VIEWPORT_PADDING = 8;

function clampPosition(x: number, y: number): { x: number; y: number } {
  const cx = Math.max(
    VIEWPORT_PADDING,
    Math.min(x, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING),
  );
  const cy = Math.max(
    VIEWPORT_PADDING,
    Math.min(y, window.innerHeight - MENU_HEIGHT_MAX - VIEWPORT_PADDING),
  );
  return { x: cx, y: cy };
}

export function SourceTableContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  // Open the menu on contextmenu over a CodeMirror line that sits inside
  // a table.
  useEffect(() => {
    const container = document.getElementById("source-container");
    if (!container) return;

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Bail unless the click is on a CodeMirror content line. This
      // prevents accidental capture on the gutter, scroller padding,
      // etc.
      if (!target.closest(".cm-line")) return;

      const view = useEditorStore.getState().editorView;
      if (!view) return;

      const pos = view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });
      if (pos == null) return;

      const result = computeSourceTableContext(view.state, pos);
      if (!result) return;

      event.preventDefault();
      event.stopPropagation();

      const { x, y } = clampPosition(event.clientX, event.clientY);
      setMenu({ x, y, pos, context: result.ctx });

      loggingService.logEventSync({
        level: "info",
        event: "ui.table-context-menu.open",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          mode: "source",
          rowIndex: result.ctx.rowIndex,
          colIndex: result.ctx.colIndex,
          rowCount: result.ctx.rowCount,
          colCount: result.ctx.colCount,
        },
      });
    };

    container.addEventListener("contextmenu", handleContextMenu);
    return () => container.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Dismiss on outside click / Escape / window resize / scroll.
  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      // Arrow / Home / End / Enter / Space keyboard traversal — mirrors
      // the WYSIWYG TableContextMenu (audit fix M10).
      if (!menuRef.current) return;
      const items = Array.from(
        menuRef.current.querySelectorAll<HTMLElement>(
          'button[role="menuitem"]:not([aria-disabled="true"]):not([disabled]), ' +
            'button[role="menuitemradio"]:not([aria-disabled="true"]):not([disabled])',
        ),
      );
      if (items.length === 0) return;
      const active = document.activeElement;
      const idx = items.findIndex((el) => el === active);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(idx + 1 + items.length) % items.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        if (
          active instanceof HTMLElement &&
          active.matches(
            'button[role="menuitem"], button[role="menuitemradio"]',
          )
        ) {
          event.preventDefault();
          active.click();
        }
      }
    };
    const handleScroll = () => closeMenu();
    const handleResize = () => closeMenu();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [menu, closeMenu]);

  // Focus the first enabled item on open (audit fix M10 parity).
  useEffect(() => {
    if (!menu || !menuRef.current) return;
    const first = menuRef.current.querySelector<HTMLElement>(
      'button[role="menuitem"]:not([aria-disabled="true"]):not([disabled]), ' +
        'button[role="menuitemradio"]:not([aria-disabled="true"]):not([disabled])',
    );
    first?.focus();
  }, [menu]);

  if (!menu) return null;

  const actions = getTableActions(menu.context);

  const handlePick = (id: TableActionId) => {
    const view = useEditorStore.getState().editorView;
    const actionId = loggingService.generateActionId();
    let succeeded = false;

    if (view) {
      try {
        succeeded = dispatchSourceTableAction(view, id, menu.pos);
      } catch {
        succeeded = false;
      }
    }

    loggingService.logEventSync({
      level: succeeded ? "info" : "warn",
      event: `editor.table.${id}`,
      status: succeeded ? "success" : "fail",
      actionId,
      context: {
        mode: "source",
        rowIndex: menu.context.rowIndex,
        colIndex: menu.context.colIndex,
      },
    });

    closeMenu();
  };

  return (
    <div
      ref={menuRef}
      className="table-context-menu"
      role="menu"
      aria-label="Table actions"
      style={{ left: menu.x, top: menu.y, width: MENU_WIDTH }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ActionList actions={actions as TableAction[]} onPick={handlePick} />
    </div>
  );
}
