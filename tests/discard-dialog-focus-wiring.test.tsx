/**
 * D48 — every "Unsaved changes" discard dialog opens with focus on "Keep editing",
 * so a reflexive Enter keeps the edits instead of discarding them.
 *
 * BottomTabs and Sidebar are prop-driven (no stores), so they are rendered for real and the
 * discard dialog is opened through the close control a user clicks (Level 4 focus state).
 *
 * App.tsx cannot be rendered in this suite — see the reasoned waiver in
 * `tests/large-document-guard-call-site.test.ts` — so its call site is pinned by source
 * text instead (below Level 1): the `ConfirmDialog` whose confirm label is
 * "Discard changes" must carry `destructive`. That pin cannot prove the prop reaches the
 * runtime element; CD-11 in `tests/confirm-dialog.test.tsx` proves what the prop does.
 *
 * Mock boundary: only `@tauri-apps/api/core` (FileItem logs clicks through loggingService).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: () => Promise.resolve(null),
}));

import { BottomTabs } from "../src/components/BottomTabs/BottomTabs";
import { Sidebar } from "../src/components/Sidebar/Sidebar";
import type { Document } from "../src/types/document";

const dirty: Document = {
  id: "doc-1",
  path: "/tmp/secret-plan.md",
  content: "# edits",
  encoding: "utf-8",
  lineEnding: "lf",
  isModified: true,
  lastSaved: null,
  fileSize: null,
};

describe("discard dialog initial focus wiring (D48)", () => {
  it("DW-1: BottomTabs — closing a dirty tab opens the dialog with focus on Keep editing; Enter keeps the tab", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <BottomTabs
        documents={[dirty]}
        activeDocumentId="doc-1"
        onSelect={() => {}}
        onClose={onClose}
        onNewDocument={() => {}}
      />,
    );
    const close = container.querySelector(".bottom-tab__close");
    expect(close).not.toBeNull();
    await user.click(close as Element);
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("DW-2: Sidebar — closing a dirty file opens the dialog with focus on Keep editing; Enter keeps the file", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Sidebar documents={[dirty]} activeDocumentId="doc-1" onSelect={() => {}} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "x" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("DW-3: App.tsx — the Discard-changes ConfirmDialog passes destructive (source pin; App is not renderable here)", () => {
    const src = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8");
    const blocks = src.match(/<ConfirmDialog\b[^>]*?\/>/gs) ?? [];
    const discard = blocks.filter((b) => b.includes('confirmLabel="Discard changes"'));
    expect(discard).toHaveLength(1);
    expect(discard[0]).toMatch(/\sdestructive(\s|=\{true\}|\/>)/);
  });
});
