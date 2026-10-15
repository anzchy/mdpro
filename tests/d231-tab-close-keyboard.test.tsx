/**
 * D231: a document tab's "×" was a `<span role="button" tabIndex={0}>` nested
 * inside the tab's own `<button>`, with `onClick` only. Tab landed on it at
 * opacity 0, and Enter / Space on it did nothing (Stage 3 batch 5). The user
 * chose option c on prototype/d231-d234-focus: the × is its own button, a
 * sibling of the tab's select button, named "Close <name>", and keyboard
 * operable; the styling half is pinned in d231-tab-active-contrast.test.ts.
 *
 * Real component, real ConfirmDialog; no mocks needed.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BottomTabs } from "../src/components/BottomTabs/BottomTabs";
import type { Document } from "../src/types/document";

function doc(id: string, path: string, isModified = false): Document {
  return { id, path, content: "", encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: null };
}

function renderTabs() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <BottomTabs
      documents={[doc("a", "/x/a.md"), doc("b", "/x/b.md", true)]}
      activeDocumentId="a"
      onSelect={onSelect}
      onClose={onClose}
      onNewDocument={() => {}}
      sidebarShown
      onToggleSidebar={() => {}}
    />,
  );
  return {
    onSelect,
    onClose,
    selectA: screen.getByRole("button", { name: "a.md" }),
    closeA: screen.getByRole("button", { name: "Close a.md" }),
    selectB: screen.getByRole("button", { name: "b.md" }),
    closeB: screen.getByRole("button", { name: "Close b.md" }),
  };
}

describe("D231 the tab × is a keyboard-operable button of its own", () => {
  it("each × is a button named for its document, not nested in another button", () => {
    const { closeA, closeB } = renderTabs();
    for (const close of [closeA, closeB]) {
      expect(close.tagName).toBe("BUTTON");
      expect(close.parentElement?.closest("button")).toBeNull();
    }
  });

  it("Tab goes from a tab to its ×, then to the next tab", async () => {
    const user = userEvent.setup();
    const { selectA, closeA, selectB } = renderTabs();
    selectA.focus();
    await user.tab();
    expect(document.activeElement).toBe(closeA);
    await user.tab();
    expect(document.activeElement).toBe(selectB);
  });

  it("Enter on a saved document's × closes it", async () => {
    const user = userEvent.setup();
    const { closeA, onClose, onSelect } = renderTabs();
    closeA.focus();
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledWith("a", true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Space on a saved document's × closes it", async () => {
    const user = userEvent.setup();
    const { closeA, onClose } = renderTabs();
    closeA.focus();
    await user.keyboard(" ");
    expect(onClose).toHaveBeenCalledWith("a", true);
  });

  it("Enter on an unsaved document's × asks first and closes nothing", async () => {
    const user = userEvent.setup();
    const { closeB, onClose } = renderTabs();
    closeB.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: /Unsaved changes/ })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Enter on the tab itself selects it and closes nothing", async () => {
    const user = userEvent.setup();
    const { selectB, onClose, onSelect } = renderTabs();
    selectB.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a mouse click on the × closes without also selecting the tab", async () => {
    const user = userEvent.setup();
    const { closeA, onClose, onSelect } = renderTabs();
    await user.click(closeA);
    expect(onClose).toHaveBeenCalledWith("a", true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
