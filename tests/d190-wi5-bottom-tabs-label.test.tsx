/**
 * D190-WI-5 (audit W5): a Windows document's tab shows its file name.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BottomTabs } from "../src/components/BottomTabs/BottomTabs";
import type { Document } from "../src/types/document";

function doc(id: string, path: string): Document {
  return {
    id,
    path,
    content: "",
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

const noop = () => {};

describe("BottomTabs label (D190-WI-5)", () => {
  it("shows the file name of a Windows path, with the full path as its title", () => {
    render(
      <BottomTabs
        documents={[doc("d1", "C:\\Users\\jack\\notes.md"), doc("d2", "/Users/jack/b.md")]}
        activeDocumentId="d1"
        onSelect={noop}
        onClose={noop}
        onNewDocument={noop}
        sidebarShown
        onToggleSidebar={noop}
      />,
    );
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.queryByText("C:\\Users\\jack\\notes.md")).toBeNull();
    expect(screen.getByText("b.md")).toBeTruthy();
    const tab = screen.getByTitle("C:\\Users\\jack\\notes.md");
    expect(tab.textContent).toContain("notes.md");
  });
});
