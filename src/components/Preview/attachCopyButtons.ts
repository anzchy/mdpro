/**
 * @module attachCopyButtons
 * Purpose: Inject a single "copy" button into every block-level code block
 * (`pre > code`) inside a rendered preview container and wire its click to copy
 * the block's exact source to the clipboard (WI-2). Inline `<code>` is skipped.
 *
 * @coordinates-with extractCodeSource.ts (source recovery)
 * @coordinates-with Preview.tsx (invoked after the highlight.js pass)
 *
 * Key decisions:
 * - Operates on a live container so it works for both the React preview and a
 *   plain jsdom container (rule 10: extracted logic, not editor DOM).
 * - Idempotent: a `data-copy-button` marker on the wrapper prevents double
 *   injection across preview re-renders.
 * - One signal per event (rule 30): the button itself flips to a single
 *   "Copied" / "Copy failed" state — no toast spray.
 *
 * Known limitations:
 * - WYSIWYG (Milkdown) code blocks are not wired here; the shared
 *   extractCodeSource is reusable but the nodeview wiring is a follow-up.
 */
import { loggingService } from "../../services/loggingService";
import { extractCodeSource } from "./extractCodeSource";

const COPY_LABEL = "Copy";
const COPIED_LABEL = "Copied";
const ERROR_LABEL = "Copy failed";
const RESET_DELAY_MS = 2000;

/** Build the copy button for a given code element. */
function createCopyButton(code: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-copy-button";
  button.setAttribute("data-copy-button", "");
  button.setAttribute("aria-label", COPY_LABEL);
  button.textContent = COPY_LABEL;

  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const setState = (label: string, state: "idle" | "copied" | "error") => {
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.dataset.copyState = state;
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const actionId = loggingService.generateActionId();
    const source = extractCodeSource(code);

    loggingService.logEventSync({
      level: "info",
      event: "ui.codeblock.copy",
      status: "start",
      actionId,
      context: { length: source.length },
    });

    void navigator.clipboard
      .writeText(source)
      .then(() => {
        setState(COPIED_LABEL, "copied");
        loggingService.logEventSync({
          level: "info",
          event: "ui.codeblock.copy",
          status: "success",
          actionId,
          context: { length: source.length },
        });
      })
      .catch((error: unknown) => {
        setState(ERROR_LABEL, "error");
        loggingService.logEventSync({
          level: "error",
          event: "ui.codeblock.copy",
          status: "fail",
          actionId,
          context: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      })
      .finally(() => {
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => setState(COPY_LABEL, "idle"), RESET_DELAY_MS);
      });
  });

  return button;
}

/**
 * Inject one copy button per block-level code block in `container`.
 * Idempotent across re-renders; inline `<code>` is left untouched.
 */
export function attachCopyButtons(container: HTMLElement): void {
  const blocks = container.querySelectorAll<HTMLElement>("pre > code");
  blocks.forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.querySelector(":scope > [data-copy-button]")) return;
    pre.appendChild(createCopyButton(code));
  });
}
