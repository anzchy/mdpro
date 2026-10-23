import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock());

import { TableInsertModal } from "../src/components/Editor/TableInsertModal";
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";
import { useTableInsertStore } from "../src/stores/tableInsertStore";

afterEach(() => { cleanup(); useTableInsertStore.getState().clearPending(); });

it("M1b WI-6 labels the active custom Table chord and omits an unassigned chord", () => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
  const applied = defaultAppliedShortcuts();
  applied.bindings.paragraphTable = { state: "bound", chord: "Cmd+Option+Y" };
  useTableInsertStore.getState().requestInsert(() => {});
  const { rerender } = render(<TableInsertModal appliedShortcuts={applied} />);
  expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBeTruthy();
  expect(screen.getByRole("heading", { name: /Insert Table/ }).textContent).toContain("Cmd+Option+Y");
  applied.bindings.paragraphTable = { state: "unassigned" };
  rerender(<TableInsertModal appliedShortcuts={{ ...applied, bindings: { ...applied.bindings } }} />);
  expect(screen.getByRole("heading", { name: /Insert Table/ }).textContent).toBe("Insert Table");
});
