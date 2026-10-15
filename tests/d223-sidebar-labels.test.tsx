/**
 * D223: the sidebar's "Table of Contents" header and the WYSIWYG / SOURCE
 * mode badge are gone, with the sidebar shown or hidden (user's prototype
 * ruling 「B: remove everywhere (Recommended)」). The top bands stay as window
 * drag regions for the macOS traffic lights, and the outline keeps its
 * accessible name.
 *
 * App cannot be rendered in this suite (tests/large-document-guard-call-site
 * .test.ts), so the sidebar-hidden band is pinned by source text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TOCSidebarContainer } from "../src/components/Sidebar";
import { asAnchorSlug, asHeadingKey, type TOCEntry } from "../src/types/toc";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const noop = () => {};
/** One heading, so the outline renders its nav rather than the empty state. */
const ENTRY: TOCEntry = {
  key: asHeadingKey("k1"),
  anchorSlug: asAnchorSlug("intro"),
  level: 2,
  text: "Intro",
  lineNumber: 1,
  offset: 0,
  children: [],
};

function renderSidebar() {
  return render(
    <TOCSidebarContainer
      tocEntries={[ENTRY]}
      activeTocEntryId={null}
      collapsedTocIds={new Set()}
      onTocEntryClick={noop}
      onTocToggleCollapse={noop}
      sidebarWidth={220}
      onSidebarResize={noop}
    />,
  );
}

describe("D223 sidebar shown: no header, no mode badge", () => {
  it("renders neither label", () => {
    const { container } = renderSidebar();
    expect(screen.queryByText("Table of Contents")).toBeNull();
    expect(screen.queryByText(/^(WYSIWYG|SOURCE)$/i)).toBeNull();
    expect(container.querySelector(".sidebar-header, .sidebar-mode-label")).toBeNull();
  });

  it("the outline keeps its accessible name", () => {
    renderSidebar();
    expect(screen.getByRole("navigation", { name: "Table of Contents" })).toBeTruthy();
  });

  it("the top band stays a window drag region", () => {
    const { container } = renderSidebar();
    const band = container.querySelector(".sidebar-traffic-area");
    expect(band?.hasAttribute("data-tauri-drag-region")).toBe(true);
  });
});

describe("D223 sidebar hidden: the main band carries no badge (source pin)", () => {
  const app = read("src/App.tsx");

  it("App renders no mode badge and no longer imports its label", () => {
    expect(app).not.toMatch(/sidebar-mode-label/);
    expect(app).not.toMatch(/getViewModeLabel/);
  });

  it("the main band stays a window drag region", () => {
    expect(app).toMatch(/<div className="main-traffic-area" data-tauri-drag-region\s*\/>/);
  });

  it("getViewModeLabel is gone from the sidebar module", () => {
    expect(read("src/components/Sidebar/index.tsx")).not.toMatch(/getViewModeLabel/);
  });
});

describe("D223 CSS: the two label rules are deleted", () => {
  it("app-shell.css has no .sidebar-header or .sidebar-mode-label rule", () => {
    const css = read("src/styles/sections/app-shell.css");
    expect(css).not.toMatch(/\.sidebar-header\b/);
    expect(css).not.toMatch(/\.sidebar-mode-label\b/);
  });
});
