import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TOCSidebar } from "../src/components/Sidebar/TOCSidebar";
import { asAnchorSlug, asHeadingKey } from "../src/types/toc";
import type { HeadingKey, TOCEntry } from "../src/types/toc";

/*
 * WI-3.5.6 — the component-level statement of `key !== anchorSlug`.
 *
 *   V-L1  collapse/active depend on `key` alone: for a fixed `key`, the collapsed and
 *         active rendering is invariant under any change to `anchorSlug` or `text`.
 *   V-L2  `href` depends on `anchorSlug` alone: for a fixed `anchorSlug` the rendered
 *         `href` is invariant under any change to `key`, and never contains the key.
 *
 * No mocks: real React render, props only. `TOCSidebar` is the logic under test.
 */

interface EntrySpec {
  key: string;
  anchorSlug: string;
  text: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  children?: EntrySpec[];
}

let nextLine = 1;

function entry(spec: EntrySpec): TOCEntry {
  const line = nextLine++;
  return {
    key: asHeadingKey(spec.key),
    anchorSlug: asAnchorSlug(spec.anchorSlug),
    level: spec.level ?? 2,
    text: spec.text,
    lineNumber: line,
    offset: line * 10,
    children: (spec.children ?? []).map(entry),
  };
}

/**
 * The component is controlled, so the test owns the collapse reducer. This is the
 * test's own state, not a mock of one: `Set<HeadingKey>` toggled exactly the way
 * `tocStore.toggleCollapsed` toggles it, so a click has to travel key-in/key-out
 * through the real prop contract to change anything.
 */
function Harness({
  entries,
  activeEntryId = null,
  onEntryClick = () => {},
}: {
  entries: TOCEntry[];
  activeEntryId?: HeadingKey | null;
  onEntryClick?: (key: HeadingKey) => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<HeadingKey>>(
    () => new Set<HeadingKey>(),
  );

  const onToggleCollapse = (key: HeadingKey) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <TOCSidebar
      entries={entries}
      activeEntryId={activeEntryId}
      collapsedIds={collapsedIds}
      onEntryClick={onEntryClick}
      onToggleCollapse={onToggleCollapse}
    />
  );
}

/** The `.toc-entry__content` row wrapping a link, reached from the link's role query. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByRole("link", { name }).closest("div");
  if (row === null) throw new Error(`no row element around link "${name}"`);
  return row;
}

describe("TOCSidebar — collapse and active key off HeadingKey (V-L1)", () => {
  it("V1: keeps a section collapsed across a rename that changes text and slug", async () => {
    const user = userEvent.setup();

    const before = [
      entry({
        key: "k-parent",
        anchorSlug: "intro",
        text: "Intro",
        level: 2,
        children: [{ key: "k-child", anchorSlug: "details", text: "Details", level: 3 }],
      }),
    ];

    const { rerender } = render(<Harness entries={before} />);

    expect(screen.getByRole("link", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Collapse" }));

    expect(screen.queryByRole("link", { name: "Details" })).toBeNull();
    const collapsedToggle = screen.getByRole("button", { name: "Expand" });
    expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");

    // Same `key`, new text and new slug — a rename, which is exactly the revision that
    // used to drop the collapse when the sidebar keyed off the anchor.
    const after = [
      entry({
        key: "k-parent",
        anchorSlug: "introduction",
        text: "Introduction",
        level: 2,
        children: [{ key: "k-child", anchorSlug: "details", text: "Details", level: 3 }],
      }),
    ];

    rerender(<Harness entries={after} />);

    // Mandatory: without this the assertions below would also pass for a rerender that
    // silently never applied.
    expect(screen.getByRole("link", { name: "Introduction" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Intro" })).toBeNull();

    expect(screen.queryByRole("link", { name: "Details" })).toBeNull();
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("V3: collapses one of two identically-named siblings, leaving the other expanded", async () => {
    const user = userEvent.setup();

    const entries = [
      entry({
        key: "k-first",
        anchorSlug: "intro",
        text: "Intro",
        level: 2,
        children: [{ key: "k-first-child", anchorSlug: "alpha", text: "Alpha", level: 3 }],
      }),
      entry({
        key: "k-second",
        anchorSlug: "intro-1",
        text: "Intro",
        level: 2,
        children: [{ key: "k-second-child", anchorSlug: "beta", text: "Beta", level: 3 }],
      }),
    ];

    render(<Harness entries={entries} />);

    // Both toggles carry the same accessible name — that is the point of the case, so
    // the first one is resolved positionally, not by name.
    const firstSection = screen.getAllByRole("listitem")[0];
    await user.click(within(firstSection).getByRole("button", { name: "Collapse" }));

    expect(screen.queryByRole("link", { name: "Alpha" })).toBeNull();
    expect(screen.getByRole("link", { name: "Beta" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("V4: keeps the active highlight on the same key across a rename", () => {
    const activeKey = asHeadingKey("k-child");

    const before = [
      entry({
        key: "k-parent",
        anchorSlug: "intro",
        text: "Intro",
        level: 2,
        children: [{ key: "k-child", anchorSlug: "details", text: "Details", level: 3 }],
      }),
    ];

    const { rerender } = render(<Harness entries={before} activeEntryId={activeKey} />);

    expect(rowOf("Details")).toHaveClass("toc-entry__content--active");
    expect(rowOf("Intro")).not.toHaveClass("toc-entry__content--active");

    const after = [
      entry({
        key: "k-parent",
        anchorSlug: "intro",
        text: "Intro",
        level: 2,
        children: [
          { key: "k-child", anchorSlug: "deep-details", text: "Deep Details", level: 3 },
        ],
      }),
    ];

    rerender(<Harness entries={after} activeEntryId={activeKey} />);

    expect(screen.queryByRole("link", { name: "Details" })).toBeNull();
    expect(rowOf("Deep Details")).toHaveClass("toc-entry__content--active");
    expect(rowOf("Intro")).not.toHaveClass("toc-entry__content--active");
  });

  it("V7: hands the coordination key, not the slug, to the navigation callback", async () => {
    const user = userEvent.setup();
    const seen: string[] = [];

    render(
      <Harness
        entries={[entry({ key: "k-nav", anchorSlug: "intro", text: "Intro" })]}
        onEntryClick={(key) => seen.push(key)}
      />,
    );

    await user.click(screen.getByRole("link", { name: "Intro" }));

    // `tocStore.navigateToEntry` is typed `(key: HeadingKey)`. The brand is erased at
    // runtime, so only this assertion stops the slug being handed over in its place.
    expect(seen).toEqual(["k-nav"]);
  });

  it("V6: does not remount the row on rename, so keyboard focus survives it", async () => {
    const user = userEvent.setup();

    const before = [
      entry({
        key: "k-parent",
        anchorSlug: "intro",
        text: "Intro",
        level: 2,
        children: [{ key: "k-child", anchorSlug: "details", text: "Details", level: 3 }],
      }),
    ];

    const { rerender } = render(<Harness entries={before} />);

    await user.tab();
    const toggle = screen.getByRole("button", { name: "Collapse" });
    expect(toggle).toHaveFocus();

    const after = [
      entry({
        key: "k-parent",
        anchorSlug: "introduction",
        text: "Introduction",
        level: 2,
        children: [{ key: "k-child", anchorSlug: "details", text: "Details", level: 3 }],
      }),
    ];

    rerender(<Harness entries={after} />);

    expect(screen.getByRole("link", { name: "Introduction" })).toBeInTheDocument();
    // A React list keyed by `anchorSlug` would unmount this row and mount a new one;
    // the DOM node would be replaced and focus would fall back to document.body.
    expect(screen.getByRole("button", { name: "Collapse" })).toHaveFocus();
  });
});

describe("TOCSidebar — href is the anchor slug (V-L2)", () => {
  /*
   * No key is a substring of its own slug, so `href.includes(key)` is a real negative.
   * The third row is the confusable one: the *slug* is a prefix of the *key*, so an
   * implementation that emitted `#${entry.key}` would still contain the slug — only the
   * exact-equality assertion catches it. The fourth row is the allocator's fallback slug
   * (`tocService.ts` emits `"heading"` when the text slugs to empty).
   */
  const table: Array<{ key: string; anchorSlug: string; text: string }> = [
    { key: "k-1", anchorSlug: "intro", text: "Intro" },
    { key: "k-2", anchorSlug: "intro-1", text: "Intro again" },
    { key: "intro-9", anchorSlug: "intro", text: "Slug is a prefix of the key" },
    { key: "k-4", anchorSlug: "heading", text: "🎉" },
    { key: "k-5", anchorSlug: "安装步骤", text: "安装步骤" },
  ];

  for (const row of table) {
    it(`V2: href for "${row.text}" is #${row.anchorSlug} and never the key`, () => {
      render(
        <Harness
          entries={[entry({ key: row.key, anchorSlug: row.anchorSlug, text: row.text })]}
        />,
      );

      const href = screen.getByRole("link", { name: row.text }).getAttribute("href");

      expect(href).toBe(`#${row.anchorSlug}`);
      expect(href?.includes(row.key)).toBe(false);
    });
  }
});

describe("TOCSidebar — boundary", () => {
  it("V5: renders the empty-state message and no navigation landmark for an empty outline", () => {
    render(<Harness entries={[]} />);

    expect(screen.getByText("No headings found in this document.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
