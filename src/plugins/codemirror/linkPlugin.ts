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
 *
 * @coordinates-with src/stores/linkInsertStore.ts
 * @coordinates-with src/components/Editor/LinkInsertModal.tsx
 * @coordinates-with src/hooks/useKeyboardShortcuts.ts
 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { createPlugin } from "../core/pluginTypes";
import { useLinkInsertStore } from "../../stores/linkInsertStore";

/** Insert `[text](url)` over every selection range; a blocked URL inserts nothing. */
const applyLink = (view: EditorView, href: string): void => {
  const rawUrl = href.trim();
  // Block dangerous protocols
  const lower = rawUrl.toLowerCase().replace(/\s+/g, "");
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return;
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
};

export const insertLinkCommand = (view: EditorView): boolean => {
  if (view.state.readOnly) return false;

  const store = useLinkInsertStore.getState();
  if (store.pendingCallback !== null) return true;

  const apply = (href: string) => {
    if (view.dom.isConnected) applyLink(view, href);
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
  codemirrorExtension: () =>
    keymap.of([
      {
        key: "Mod-k",
        run: insertLinkCommand,
      },
    ]),
});
