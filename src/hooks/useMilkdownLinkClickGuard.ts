/**
 * @module useMilkdownLinkClickGuard
 * Purpose: enforce a scheme allowlist on link clicks in the WYSIWYG editor
 * (#10), and hand the OS opener only a value that has been validated. Safe
 * links are opened externally via `@tauri-apps/plugin-opener`. Extracted from
 * MilkdownEditor.tsx (audit M7) to keep that file under the 300-line guideline.
 *
 * Two early returns for things that are not links, then four outcomes, all
 * decided synchronously before any `await` (WI-7, WI-10):
 *   0a. the click target has no ancestor `<a>` → ignored entirely; this is the
 *       commonest runtime path, ordinary paragraph text.
 *   0b. the `<a>` carries **no `href` attribute** → not a link either.
 *       `preventDefault()` only: no `stopPropagation()`, and no log at any
 *       level. ProseMirror renders bare anchors transiently while a link is
 *       being edited, and a `warn` that fires during ordinary editing is how
 *       `warn` stops meaning anything — the same argument outcome 3 already
 *       makes for its `debug` level (decision C′). The test is `=== null`, not
 *       a falsy check: `href=""` is a **self-link** that resolves to the
 *       document URL, and it still goes through gate A.
 *   1. **Gate A** `isSafeHref(rawHref)` rejects → blocked, reason `scheme`.
 *      Judged on the raw `href` attribute, i.e. what the author wrote.
 *   2. `isExternallyOpenableHref(resolvedHref)` → handed to the OS opener.
 *   3. `isSameAppOriginHref(resolvedHref, documentUrl)` → in-document
 *      navigation: the click is cancelled and one `debug` log is emitted, with
 *      no opener call. In-document navigation is not implemented, so the click
 *      is inert. It is **not** a block and emits no `blocked` entry — at
 *      warn/fail every relative-link click in production would emit a
 *      security-shaped log line.
 *   4. otherwise → blocked, reason `resolved-mismatch`.
 *
 * Gate A judges the attribute; outcomes 2 and 3 judge `link.href`, i.e. what
 * the platform would actually navigate to after WHATWG resolution. Neither
 * string is sufficient alone. The URL parser deletes interior TAB/LF/CR, so
 * `java<TAB>script:` passes a naive check on the attribute yet resolves to
 * `javascript:`; conversely a scheme-less attribute can resolve into a hostile
 * scheme through the document base. Checking one string and opening another was
 * the defect this module was rewritten to remove.
 *
 * **The app's own scheme is deliberately not openable.** Treating a link to the
 * app's own origin as an external handoff is what let an attacker-chosen host
 * reach the OS opener: under a `tauri://localhost` origin `//evil.com/x`
 * resolves to `tauri://evil.com/x`, the app's own scheme wearing a hostile host
 * (finding C1). Gate A now rejects protocol-relative and backslash-authority
 * forms outright, and no branch hands an application-scheme URL to the opener.
 *
 * `preventDefault()` is called on **every** outcome, and is deliberately not
 * hoisted above the branch split. `tauri-plugin-opener` installs a window-level
 * click handler (`init-iife.js`) that guards on `event.defaultPrevented`, and
 * this container listener runs first, so an un-prevented click on any branch
 * would turn that handler into a second sink. `stopPropagation()` is called
 * **only** on the blocked branches, via `blockClick` — other container
 * listeners (context menus) legitimately observe in-document clicks, so
 * hoisting that call alongside `preventDefault()` would silently break them.
 *
 * Everything the handler needs is captured into locals up front, and `link` is
 * never dereferenced again once the dynamic import begins: a ProseMirror
 * re-render or an `mcp:write_document` event can mutate the anchor mid-await
 * (TOCTOU). The string passed to `openUrl` is the same string that cleared
 * `isExternallyOpenableHref`.
 *
 * The `window.open` fallback was **removed** (ADR-0001). It was the last path
 * able to hand a URL to the webview outside the validated capture. Accepted
 * cost: a link that fails to open now does nothing the user can see, and the
 * only evidence is one `editor.milkdown.link.open` failure entry in
 * `~/.mdpro/mdpro.log`. A visible toast was considered and deferred as UI work
 * that does not belong in a security fix.
 *
 * @coordinates-with src/services/linkSafety.ts (`isSafeHref`,
 *   `isExternallyOpenableHref`, `isSameAppOriginHref`)
 */

import { useEffect } from "react";
import { loggingService } from "../services/loggingService";
import {
  isExternallyOpenableHref,
  isSafeHref,
  isSameAppOriginHref,
} from "../services/linkSafety";

/**
 * Blocked hrefs are attacker-controlled, so they are truncated before being
 * written to the log rather than appended unbounded.
 */
const LOGGED_HREF_MAX_LENGTH = 100;

/** Which gate rejected the click — surfaced in the log for triage. */
type BlockReason = "scheme" | "resolved-mismatch";

export function useMilkdownLinkClickGuard(activeDocumentId: string | null): void {
  useEffect(() => {
    const container = document.getElementById("milkdown-container");
    if (!container) return;

    const blockClick = (event: MouseEvent, reason: BlockReason, href: string) => {
      event.preventDefault();
      event.stopPropagation();
      loggingService.logEventSync({
        level: "warn",
        event: "editor.milkdown.link.blocked",
        status: "fail",
        actionId: loggingService.generateActionId(),
        context: { reason, href: href.substring(0, LOGGED_HREF_MAX_LENGTH) },
      });
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      if (!link || !(link instanceof HTMLAnchorElement)) return;

      // Capture once, synchronously. No DOM read may follow the import below.
      const rawHref = link.getAttribute("href");
      const resolvedHref = link.href;
      const documentUrl = window.location.href;

      // Not a link. `preventDefault()` is kept so the "called on every outcome"
      // invariant (ADR-0002 decision 5, and consequence (d)) holds without
      // depending on `tauri-plugin-opener`'s own `!t.href` early return in
      // `init-iife.js`. `stopPropagation()` and the log are both deliberately
      // absent: other container listeners still need this click, and a bare
      // anchor is editor state, not a security event.
      if (rawHref === null) {
        event.preventDefault();
        return;
      }

      // Gate A — what the author wrote.
      if (!isSafeHref(rawHref)) {
        blockClick(event, "scheme", rawHref);
        return;
      }

      // May the OS opener have this? Checked before the in-document question,
      // because at the dev origin the two overlap and the handoff is the
      // behavior dev builds rely on.
      if (isExternallyOpenableHref(resolvedHref)) {
        event.preventDefault();
        import("@tauri-apps/plugin-opener")
          .then(({ openUrl }) => openUrl(resolvedHref))
          .catch((error: unknown) => {
            loggingService.logEventSync({
              level: "error",
              event: "editor.milkdown.link.open",
              status: "fail",
              actionId: loggingService.generateActionId(),
              context: { href: resolvedHref.substring(0, LOGGED_HREF_MAX_LENGTH) },
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }

      // The app's own page. Cancel the click so `tauri-plugin-opener`'s
      // window-level handler cannot pick it up, but let it keep propagating —
      // and log at `debug`, because this is ordinary navigation, not a block.
      if (isSameAppOriginHref(resolvedHref, documentUrl)) {
        event.preventDefault();
        loggingService.logEventSync({
          level: "debug",
          event: "editor.milkdown.link.in_document",
          status: "success",
          actionId: loggingService.generateActionId(),
          context: { href: resolvedHref.substring(0, LOGGED_HREF_MAX_LENGTH) },
        });
        return;
      }

      // Neither openable nor our own page. The rejected value is the one
      // logged, since that is the one that failed.
      blockClick(event, "resolved-mismatch", resolvedHref);
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [activeDocumentId]);
}
