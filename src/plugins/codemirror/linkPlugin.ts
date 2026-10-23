/**
 * Purpose: Source mode ⌘K — wrap the selection (or "link") as `[text](url)`.
 *
 * Key decisions:
 * - The URL comes from the in-app `LinkInsertModal` through `useLinkInsertStore`
 *   (mode "source"), the same modal WYSIWYG uses. It used `window.prompt`, which
 *   the packaged app never shows, so ⌘K did nothing (D55).
 * - A ⌘K while a request is already open keeps that request: Source ⌘K reaches
 *   this command from both the keymap below and `useKeyboardShortcuts`.
 * - Whenever the request closes (insert, Escape, Cancel, backdrop), focus goes
 *   back to the editor that asked.
 * - This one view is reused across tabs, so `view.dom.isConnected` alone cannot
 *   tell that the request's document is gone: `useLinkInsertBinding` binds the
 *   request to the active document and view mode and cancels it when either
 *   changes (D73).
 *
 * - ⌘K while another modal is open (Recovery, Settings, …) is refused and logged
 *   by `refuseModalOpenWhileModalOpen`, as Insert Table is (D235-WI-2).
 * - A menu-origin request carries D261's token through the modal; its final
 *   `view.dispatch` refuses a changed document/editor (M3b).
 *
 * @coordinates-with src/stores/linkInsertStore.ts
 * @coordinates-with src/utils/modalTabActionGuard.ts — the D235 refusal
 * @coordinates-with src/components/Editor/LinkInsertModal.tsx
 * @coordinates-with src/hooks/useKeyboardShortcuts.ts
 * @coordinates-with src/hooks/useLinkInsertBinding.ts — the D73 cancellation
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { createPlugin } from "../core/pluginTypes";
import { useLinkInsertStore } from "../../stores/linkInsertStore";
import { refuseModalOpenWhileModalOpen } from "../../utils/modalTabActionGuard";
import { abandonIfStale, type MenuTargetToken } from "../../utils/menuTargetToken";
import { useEditorStore } from "../../stores/editorStore";
import { loggingService } from "../../services/loggingService";
import { appliedKey, currentAppliedShortcuts } from "../../commands/appliedKeymap";
import { isMacPlatform } from "../../utils/platformLabels";

export interface SourceLinkOrigin {
  source: "menu" | "shortcut";
  token?: MenuTargetToken;
  actionId?: string;
}

function logMenuRefusal(origin: SourceLinkOrigin, reason: "stale" | "unsafe_url"): void {
  if (!origin.token || !origin.actionId) return;
  loggingService.logEventSync({
    level: "info", event: "ui.menu.select", status: "cancel", actionId: origin.actionId,
    context: { windowLabel: origin.token.windowLabel, reason, stage: "link_submit" },
  });
}

/** Insert `[text](url)` over every selection range; a blocked URL inserts nothing. */
const applyLink = (view: EditorView, href: string): boolean => {
  const rawUrl = href.trim();
  // Block dangerous protocols
  const lower = rawUrl.toLowerCase().replace(/\s+/g, "");
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return false;
  }
  const url =
    rawUrl.length > 0 &&
    !/^https?:\/\//i.test(rawUrl) &&
    !rawUrl.startsWith("mailto:") &&
    !rawUrl.startsWith("#") &&
    !rawUrl.startsWith("/")
      ? "https://" + rawUrl
      : rawUrl;

  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const text = selected.length > 0 ? selected : "link";
    // Escape markdown-special characters in label and URL
    const safeText = text.replace(/[[\]\\]/g, "\\$&");
    const safeUrl = url.replace(/[()\\]/g, "\\$&");
    const insert = `[${safeText}](${safeUrl})`;
    const urlStart = range.from + safeText.length + 3;
    const urlEnd = urlStart + safeUrl.length;

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlEnd),
    };
  });

  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

export const insertLinkCommand = (
  view: EditorView,
  origin: SourceLinkOrigin = { source: "shortcut" },
): boolean => {
  if (view.state.readOnly) return false;

  const store = useLinkInsertStore.getState();
  if (store.pendingCallback !== null) return true;
  // D235-WI-2: not over another open modal (Recovery, Settings, …).
  if (refuseModalOpenWhileModalOpen("format.hyperlink", origin.source, origin.actionId)) return true;

  const apply = (href: string) => {
    if (origin.token && origin.actionId && abandonIfStale(origin.token, "link_submit", origin.actionId)) return;
    if (origin.token && useEditorStore.getState().viewMode !== "source") {
      logMenuRefusal(origin, "stale");
      return;
    }
    if (!view.dom.isConnected) {
      logMenuRefusal(origin, "stale");
      return;
    }
    if (!applyLink(view, href)) logMenuRefusal(origin, "unsafe_url");
  };
  store.setPendingCallback(apply, "source");

  const unsubscribe = useLinkInsertStore.subscribe((state) => {
    if (state.pendingCallback === apply) return;
    unsubscribe();
    if (view.dom.isConnected) view.focus();
  });
  return true;
};

export const linkPlugin = createPlugin({
  name: "link",
  displayName: "Link",
  supportedModes: ["codemirror"],
  priority: 90,
  defaultConfig: {
    enabled: true,
  },
  codemirrorExtension: () => {
    const key = appliedKey(currentAppliedShortcuts(), "formatHyperlink", isMacPlatform() ? "macos" : "linux");
    return keymap.of(key ? [{ key, run: insertLinkCommand }] : []);
  },
});
