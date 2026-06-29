/**
 * @module copy-code-button.test
 * Purpose: Verify attachCopyButtons — the extracted button-injection +
 * click-handler unit that powers the preview code-block copy button
 * (WI-2, Unit B). Tested against a jsdom container populated with rendered
 * `<pre><code>` HTML (rule 10: test extracted logic, not editor DOM).
 *
 * Boundaries mocked: navigator.clipboard.writeText (vi.fn) and the
 * loggingService. Asserts the value copied and the observable UI state
 * (success / error affordance), not internal call counts alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachCopyButtons } from "../src/components/Preview/attachCopyButtons";

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    generateActionId: () => "test-action-id",
    logEventSync: vi.fn(),
  },
}));

import { loggingService } from "../src/services/loggingService";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  vi.mocked(loggingService.logEventSync).mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** Find the copy button(s) by accessible name, the way a user would. */
const copyButtons = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter((b) =>
    /copy/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
  );

describe("attachCopyButtons", () => {
  // B1 — clicking copies the EXACT source and flips to a single success state
  it("copies the exact code source and shows a success affordance", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<pre><code>const x = 1;\n中文</code></pre>";
    document.body.appendChild(container);

    attachCopyButtons(container);

    const [button] = copyButtons(container);
    expect(button).toBeTruthy();
    button.click();

    // L1 on the value actually handed to the clipboard.
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe("const x = 1;\n中文");

    // Single observable success affordance (button flips to "Copied").
    await vi.waitFor(() => {
      const label = button.getAttribute("aria-label") ?? button.textContent ?? "";
      expect(/copied/i.test(label)).toBe(true);
    });

    expect(loggingService.logEventSync).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ui.codeblock.copy", status: "success" }),
    );
  });

  // B2 — one button per block-level code; inline `code` gets none
  it("adds exactly one button per block, none for inline code", () => {
    const container = document.createElement("div");
    container.innerHTML =
      "<pre><code>a = 1</code></pre>" +
      "<p>inline <code>x</code> here</p>" +
      "<pre><code>b = 2</code></pre>";
    document.body.appendChild(container);

    attachCopyButtons(container);

    expect(copyButtons(container)).toHaveLength(2);
    // Inline code's parent paragraph holds no copy button.
    const inlineCode = container.querySelector("p code")!;
    expect(copyButtons(inlineCode.parentElement!)).toHaveLength(0);
  });

  // B2b — idempotent: re-running does not double-inject
  it("does not inject a second button when run twice", () => {
    const container = document.createElement("div");
    container.innerHTML = "<pre><code>a = 1</code></pre>";
    document.body.appendChild(container);

    attachCopyButtons(container);
    attachCopyButtons(container);

    expect(copyButtons(container)).toHaveLength(1);
  });

  // B3 — clipboard rejection: NO false success, an error affordance, fail log
  it("shows an error affordance and never a false success on rejection", async () => {
    writeText.mockRejectedValue(new Error("denied"));

    const container = document.createElement("div");
    container.innerHTML = "<pre><code>x = 1</code></pre>";
    document.body.appendChild(container);

    attachCopyButtons(container);

    const [button] = copyButtons(container);
    button.click();

    await vi.waitFor(() => {
      const label = button.getAttribute("aria-label") ?? button.textContent ?? "";
      expect(/error|fail/i.test(label)).toBe(true);
    });

    // Load-bearing: the absence of a false success signal.
    const label = button.getAttribute("aria-label") ?? button.textContent ?? "";
    expect(/copied/i.test(label)).toBe(false);

    expect(loggingService.logEventSync).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ui.codeblock.copy", status: "fail" }),
    );
  });
});
