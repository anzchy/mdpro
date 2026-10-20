/**
 * Purpose: one WYSIWYG Insert Link request for the Typora keymap and M3b menu.
 * The menu receipt token is checked at the final mark mutation; the keyboard
 * path retains its existing command return and URL handling.
 *
 * @coordinates-with typoraKeymapPlugin.ts
 * @coordinates-with ../../utils/menuTargetToken.ts
 */
import { toggleMark } from "@milkdown/kit/prose/commands";
import type { Command } from "@milkdown/kit/prose/state";
import { useLinkInsertStore } from "../../stores/linkInsertStore";
import { useEditorStore } from "../../stores/editorStore";
import { loggingService } from "../../services/loggingService";
import { refuseModalOpenWhileModalOpen } from "../../utils/modalTabActionGuard";
import { abandonIfStale, type MenuTargetToken } from "../../utils/menuTargetToken";

export interface TyporaLinkOrigin {
  source: "menu" | "shortcut";
  token?: MenuTargetToken;
  actionId?: string;
}

function logMenuRefusal(origin: TyporaLinkOrigin, reason: "stale" | "unsafe_url"): void {
  if (!origin.token || !origin.actionId) return;
  loggingService.logEventSync({
    level: "info", event: "ui.menu.select", status: "cancel", actionId: origin.actionId,
    context: { windowLabel: origin.token.windowLabel, reason, stage: "link_submit" },
  });
}

/** Build one pending callback; the keymap and menu each install this same flow. */
export function makeTyporaLinkPendingCallback(
  state: Parameters<Command>[0],
  dispatch: Parameters<Command>[1],
  view: Parameters<Command>[2],
  origin: TyporaLinkOrigin,
): ((rawUrl: string) => void) | null {
  const linkMark = state.schema.marks["link"];
  if (!linkMark) return null;
  if (origin.source === "menu" && useLinkInsertStore.getState().pendingCallback !== null) return null;
  if (refuseModalOpenWhileModalOpen("format.hyperlink", origin.source, origin.actionId)) return null;

  // Keep the same immutable state and view the keyboard command captured.
  return (rawUrl: string) => {
      if (origin.token && origin.actionId && abandonIfStale(origin.token, "link_submit", origin.actionId)) return;
      if (origin.token && useEditorStore.getState().viewMode !== "wysiwyg") {
        logMenuRefusal(origin, "stale");
        return;
      }
      if (view?.isDestroyed) {
        logMenuRefusal(origin, "stale");
        return;
      }
      let url = rawUrl.trim();
      const lower = url.toLowerCase().replace(/\s+/g, "");
      if (
        lower.startsWith("javascript:") ||
        lower.startsWith("data:") ||
        lower.startsWith("vbscript:")
      ) {
        logMenuRefusal(origin, "unsafe_url");
        return;
      }
      if (
        !/^https?:\/\//i.test(url) &&
        !url.startsWith("mailto:") &&
        !url.startsWith("#") &&
        !url.startsWith("/")
      ) url = "https://" + url;
      toggleMark(linkMark, { href: url })(state, dispatch, view);
  };
}

/** Returns false as the old ⌘K keymap did: the React modal owns the answer. */
export function makeTyporaLinkCommand(origin: TyporaLinkOrigin = { source: "shortcut" }): Command {
  return (state, dispatch, view) => {
    const pending = makeTyporaLinkPendingCallback(state, dispatch, view, origin);
    if (pending) useLinkInsertStore.getState().setPendingCallback(pending);
    return false;
  };
}
