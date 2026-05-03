/**
 * @module TableContextMenu
 * Purpose: Right-click context menu for tables in WYSIWYG mode (WI-1.3).
 * Listens for `contextmenu` on `#milkdown-container`, bails when the
 * target isn't a `.ProseMirror table` cell, and bails when the target
 * is an image (the ImageContextMenu owns those — eng-review R7).
 *
 * Layered architecture:
 *   - This file: DOM listener, menu open/close lifecycle, position
 *     clamping, action dispatch with try/catch + logging.
 *   - `ActionList`: pure presentational — renders the grouped action list.
 *   - `actionDescriptors` + `contextMenu` modules: pure data + logic
 *     (see src/plugins/milkdown/table/).
 *
 * @coordinates-with src/plugins/milkdown/table/contextMenu.ts
 * @coordinates-with src/stores/milkdownEditorStore.ts
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeTableContext,
  dispatchTableAction,
  getTableActions,
} from "../../../plugins/milkdown/table/contextMenu";
import type {
  TableAction,
  TableActionId,
  TableContext,
} from "../../../plugins/milkdown/table/actionDescriptors";
import { editorViewCtx } from "@milkdown/kit/core";
import { useMilkdownEditorStore } from "../../../stores/milkdownEditorStore";
import { loggingService } from "../../../services/loggingService";
import { ActionList } from "./ActionList";

interface MenuState {
  /** Viewport coordinates (pre-clamped to fit on screen). */
  x: number;
  y: number;
  context: TableContext;
}

const MENU_WIDTH = 220;
const MENU_HEIGHT_MAX = 480;
const VIEWPORT_PADDING = 8;

function clampPosition(x: number, y: number): { x: number; y: number } {
  const cx = Math.max(VIEWPORT_PADDING, Math.min(x, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING));
  const cy = Math.max(VIEWPORT_PADDING, Math.min(y, window.innerHeight - MENU_HEIGHT_MAX - VIEWPORT_PADDING));
  return { x: cx, y: cy };
}

export function TableContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  // Open the menu on contextmenu, with bail rules per the WI-1.3 spec.
  useEffect(() => {
    const container = document.getElementById("milkdown-container");
    if (!container) return;

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      // R7: image menu owns image right-clicks. Bail before any table check
      // so a right-click on an image inside a table cell goes to image menu.
      if (target.closest(".ProseMirror img")) return;

      const inTable = target.closest(".ProseMirror table");
      if (!inTable || !container.contains(inTable)) return;

      const editor = useMilkdownEditorStore.getState().getEditor();
      if (!editor) return;

      const captured: { ctx: TableContext | null } = { ctx: null };
      try {
        (editor as { action: (fn: (ctx: unknown) => void) => void }).action((ctx) => {
          const view = (ctx as { get: (k: unknown) => unknown }).get(
            editorViewCtx,
          ) as {
            posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null;
            state: { doc: { resolve: (pos: number) => unknown }; selection: unknown };
          };
          // Audit fix H5: resolve the right-click target rather than
          // reading the cursor — browsers don't move the cursor on
          // contextmenu, so reading state.selection would mutate
          // whichever cell happened to hold the cursor (often a
          // different cell than the one the user clicked).
          const coordPos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          const $pos = coordPos
            ? (view.state.doc.resolve(coordPos.pos) as never)
            : undefined;
          captured.ctx = computeTableContext(view, $pos);
        });
      } catch {
        return;
      }
      const tableCtx = captured.ctx;
      if (!tableCtx) return;

      event.preventDefault();
      event.stopPropagation();

      const { x, y } = clampPosition(event.clientX, event.clientY);
      setMenu({ x, y, context: tableCtx });

      loggingService.logEventSync({
        level: "info",
        event: "ui.table-context-menu.open",
        status: "success",
        actionId: loggingService.generateActionId(),
        context: {
          rowIndex: tableCtx.rowIndex,
          colIndex: tableCtx.colIndex,
          rowCount: tableCtx.rowCount,
          colCount: tableCtx.colCount,
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
      }
    };
    const handleResize = () => closeMenu();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [menu, closeMenu]);

  if (!menu) return null;

  const actions = getTableActions(menu.context);

  const handlePick = (id: TableActionId) => {
    const editor = useMilkdownEditorStore.getState().getEditor();
    const actionId = loggingService.generateActionId();
    let succeeded = false;

    if (editor) {
      try {
        succeeded = dispatchTableAction(
          editor as Parameters<typeof dispatchTableAction>[0],
          id,
          menu.context,
        );
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
