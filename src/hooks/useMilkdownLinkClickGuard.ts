/**
 * @module useMilkdownLinkClickGuard
 * Purpose: Block javascript:/data:/vbscript: link clicks in the
 * WYSIWYG editor (#10). Safe links are opened externally via
 * `@tauri-apps/plugin-opener`. Extracted from MilkdownEditor.tsx
 * (audit M7) to keep that file under the 300-line guideline.
 *
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx (`isSafeHref`)
 * @coordinates-with src/components/Preview/Preview.tsx (parallel guard)
 */

import { useEffect } from "react";
import { loggingService } from "../services/loggingService";
import { isSafeHref } from "../components/Editor/MilkdownEditor";

export function useMilkdownLinkClickGuard(activeDocumentId: string | null): void {
  useEffect(() => {
    const container = document.getElementById("milkdown-container");
    if (!container) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      if (!link || !(link instanceof HTMLAnchorElement)) return;
      const href = link.getAttribute("href") ?? "";
      if (!isSafeHref(href)) {
        event.preventDefault();
        event.stopPropagation();
        loggingService.logEventSync({
          level: "warn",
          event: "editor.milkdown.link.blocked",
          status: "fail",
          actionId: loggingService.generateActionId(),
          context: { href: href.substring(0, 100) },
        });
        return;
      }
      event.preventDefault();
      import("@tauri-apps/plugin-opener")
        .then(({ openUrl }) => openUrl(link.href))
        .catch(() => window.open(link.href, "_blank", "noopener,noreferrer"));
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [activeDocumentId]);
}
