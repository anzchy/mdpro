import "./ImageContextMenu.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UseEditorReturn } from "@milkdown/react";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  findImageNodePosition,
  getImageWidthPercentAtPos,
  normalizeImageWidthPercent,
  setImageWidthPercentAtPos,
} from "../../plugins/milkdown/imageResizePlugin";
import { loggingService } from "../../services/loggingService";

const IMAGE_WIDTH_PRESETS = [25, 50, 75, 100] as const;

interface ImageContextMenuProps {
  editor: UseEditorReturn;
  activeDocumentId: string | null;
}

interface MenuState {
  x: number;
  y: number;
  pos: number;
  currentPercent: number | null;
}

function clampMenuPosition(x: number, y: number) {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - 188)),
    y: Math.max(8, Math.min(y, window.innerHeight - 260)),
  };
}

export function ImageContextMenu({ editor, activeDocumentId }: ImageContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("100");
  const selectedImageRef = useRef<HTMLImageElement | null>(null);

  const clearSelectedImage = useCallback(() => {
    selectedImageRef.current?.removeAttribute("data-mdpro-image-selected");
    selectedImageRef.current = null;
  }, []);

  const closeMenu = useCallback(() => {
    clearSelectedImage();
    setMenu(null);
    setCustomOpen(false);
  }, [clearSelectedImage]);

  useEffect(() => {
    const container = document.getElementById("milkdown-container");
    if (!container) return;

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const image = target.closest(".ProseMirror img") as HTMLImageElement | null;
      if (!image || !container.contains(image)) return;

      let nextMenu: MenuState | null = null;
      const instance = editor.get();
      if (!instance) return;

      instance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const pos = findImageNodePosition(view, image);
        if (pos === null) return;

        const point = clampMenuPosition(event.clientX, event.clientY);
        nextMenu = {
          ...point,
          pos,
          currentPercent: getImageWidthPercentAtPos(view, pos),
        };
      });

      const openedMenu = nextMenu as MenuState | null;
      if (!openedMenu) return;
      event.preventDefault();
      event.stopPropagation();

      clearSelectedImage();
      image.setAttribute("data-mdpro-image-selected", "true");
      selectedImageRef.current = image;
      setCustomValue(String(openedMenu.currentPercent ?? 100));
      setCustomOpen(false);
      setMenu(openedMenu);
    };

    container.addEventListener("contextmenu", handleContextMenu);
    return () => container.removeEventListener("contextmenu", handleContextMenu);
  }, [activeDocumentId, clearSelectedImage, editor]);

  useEffect(() => {
    if (!menu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".image-context-menu")) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
    };
  }, [closeMenu, menu]);

  useEffect(() => closeMenu, [closeMenu]);

  const applyWidth = useCallback(
    (percent: number) => {
      if (!menu) return;
      const actionId = loggingService.generateActionId();
      loggingService.logEventSync({
        level: "info",
        event: "editor.image.resize",
        status: "start",
        actionId,
        context: { percent },
      });

      let applied = false;
      let errorMessage: string | undefined;
      try {
        const instance = editor.get();
        if (instance) {
          instance.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            // Re-validate the captured position — if the document changed
            // between menu open and apply, the position may no longer point
            // at an image node.
            const node = view.state.doc.nodeAt(menu.pos);
            if (node?.type.name !== "image") return;
            applied = setImageWidthPercentAtPos(view, menu.pos, percent);
          });
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      } finally {
        loggingService.logEventSync({
          level: applied ? "info" : "warn",
          event: "editor.image.resize",
          status: applied ? "success" : "fail",
          actionId,
          context: { percent, error: errorMessage },
        });
        closeMenu();
      }
    },
    [closeMenu, editor, menu],
  );

  if (!menu) return null;

  const customPercent = normalizeImageWidthPercent(customValue);

  return (
    <div
      className="image-context-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="image-context-menu-label">Resize Image</div>
      {IMAGE_WIDTH_PRESETS.map((percent) => (
        <button
          className={`image-context-menu-button${menu.currentPercent === percent ? " is-active" : ""}`}
          key={percent}
          role="menuitem"
          type="button"
          onClick={() => applyWidth(percent)}
        >
          <span>{percent}%</span>
        </button>
      ))}
      <button
        className="image-context-menu-button"
        role="menuitem"
        type="button"
        onClick={() => setCustomOpen((open) => !open)}
      >
        <span>Custom…</span>
      </button>
      {customOpen ? (
        <form
          className="image-context-menu-custom"
          onSubmit={(event) => {
            event.preventDefault();
            if (customPercent !== null) applyWidth(customPercent);
          }}
        >
          <input
            aria-label="Custom image width percentage"
            className="image-context-menu-input"
            max={200}
            min={1}
            type="number"
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
          />
          <button
            className="image-context-menu-apply"
            disabled={customPercent === null}
            type="submit"
          >
            Apply
          </button>
        </form>
      ) : null}
    </div>
  );
}
