import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomTabs } from "../src/components/BottomTabs/BottomTabs";
import type { Document } from "../src/types/document";

const doc = (id: string, isModified: boolean): Document => ({ id, path: `${id}.md`, content: "", encoding: "UTF-8", lineEnding: "lf", isModified, lastSaved: null, fileSize: 0 });

describe("BottomTabs ARIA", () => {
  it("names tabs, dirty indicator, close controls and new button", () => {
    const props = { documents: [doc("a", true), doc("b", false)], activeDocumentId: "a", onSelect: vi.fn(), onClose: vi.fn(), onNewDocument: vi.fn(), sidebarShown: true, onToggleSidebar: vi.fn() };
    render(<BottomTabs {...props} />);
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /a\.md/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /b\.md/ }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close a.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New document" })).toBeTruthy();
  });
});
