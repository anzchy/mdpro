/**
 * D231, audit b160 M: splitting the tab into a select button and a sibling ×
 * left the tab's 10px right padding and the 6px gap beside the × outside the
 * select button, so a click there did nothing where it used to select the tab.
 * The whole tab except the × selects it again; the × still only closes.
 *
 * Real component; no mocks needed.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BottomTabs } from "../src/components/BottomTabs/BottomTabs";
import type { Document } from "../src/types/document";

function doc(id: string, path: string): Document {
  return { id, path, content: "", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null };
}

function renderTabs() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <BottomTabs
      documents={[doc("a", "/x/a.md"), doc("b", "/x/b.md")]}
      activeDocumentId="a"
      onSelect={onSelect}
      onClose={onClose}
      onNewDocument={() => {}}
      sidebarShown
      onToggleSidebar={() => {}}
    />,
  );
  const selectB = screen.getByRole("button", { name: "b.md" });
  const tabB = selectB.closest(".bottom-tab");
  if (!(tabB instanceof HTMLElement)) throw new Error("no .bottom-tab around b.md");
  return { onSelect, onClose, selectB, tabB, closeB: screen.getByRole("button", { name: "Close b.md" }) };
}

describe("D231 the whole tab except the × selects it", () => {
  it("a click in the tab's own padding or gap selects that tab", async () => {
    const user = userEvent.setup();
    const { tabB, onSelect, onClose } = renderTabs();
    await user.click(tabB);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a click on the tab's name selects it exactly once", async () => {
    const user = userEvent.setup();
    const { selectB, onSelect } = renderTabs();
    await user.click(selectB);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("a click on the × still closes without selecting", async () => {
    const user = userEvent.setup();
    const { closeB, onSelect, onClose } = renderTabs();
    await user.click(closeB);
    expect(onClose).toHaveBeenCalledWith("b", true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
