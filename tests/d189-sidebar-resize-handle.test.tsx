/**
 * D189 / ADR-0088 decision 3: the sidebar's resize handle. A vertical
 * separator on the sidebar's right edge. A drag moves only the app shell's
 * `--sidebar-width` until it settles, then commits once. Arrow keys,
 * Home/End, Enter and double-click commit at once.
 *
 * Nothing is mocked: the handle reports through its `onCommit` prop, and the
 * live width is read off the real `.app-shell` element.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarResizeHandle } from "../src/components/Sidebar/SidebarResizeHandle";

function setup(width = 220) {
  const onCommit = vi.fn();
  render(
    <div className="app-shell" data-testid="shell">
      <aside id="app-sidebar">
        <SidebarResizeHandle width={width} onCommit={onCommit} />
      </aside>
    </div>,
  );
  const handle = screen.getByRole("separator", { name: "Resize sidebar" });
  const live = () => screen.getByTestId("shell").style.getPropertyValue("--sidebar-width");
  return { onCommit, handle, live, user: userEvent.setup() };
}

describe("D189 SidebarResizeHandle — semantics", () => {
  it("is a focusable vertical separator carrying the width and its range", () => {
    const { handle } = setup(300);
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("300");
    expect(handle.getAttribute("aria-valuemin")).toBe("180");
    expect(handle.getAttribute("aria-valuemax")).toBe("480");
    expect(handle.getAttribute("aria-controls")).toBe("app-sidebar");
    expect(handle.tabIndex).toBe(0);
  });
});

describe("D189 SidebarResizeHandle — keyboard", () => {
  it.each([
    ["{ArrowRight}", 228, "keyboard"],
    ["{ArrowLeft}", 212, "keyboard"],
    ["{Shift>}{ArrowRight}{/Shift}", 252, "keyboard"],
    ["{Shift>}{ArrowLeft}{/Shift}", 188, "keyboard"],
    ["{Home}", 180, "keyboard"],
    ["{End}", 480, "keyboard"],
  ])("%s commits %s once", async (keys, want, source) => {
    const { handle, onCommit, user } = setup(220);
    handle.focus();
    await user.keyboard(keys);
    expect(onCommit.mock.calls).toEqual([[want, source]]);
  });

  it("Enter resets to the default", async () => {
    const { handle, onCommit, user } = setup(400);
    handle.focus();
    await user.keyboard("{Enter}");
    expect(onCommit.mock.calls).toEqual([[220, "reset"]]);
  });

  it("a step that cannot move the width commits nothing", async () => {
    const { handle, onCommit, user } = setup(480);
    handle.focus();
    await user.keyboard("{ArrowRight}{End}");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("other keys commit nothing and are not swallowed", () => {
    const { handle, onCommit } = setup(300);
    for (const key of ["ArrowUp", "Tab", "a", "Escape"]) {
      expect(fireEvent.keyDown(handle, { key })).toBe(true);
    }
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a handled key is prevented, so the page does not scroll", () => {
    const { handle } = setup(300);
    expect(fireEvent.keyDown(handle, { key: "ArrowRight" })).toBe(false);
  });
});

describe("D189 SidebarResizeHandle — pointer drag", () => {
  it("moves only the live width during a drag, then commits the final width once", async () => {
    const { handle, onCommit, live, user } = setup(220);
    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 100 } },
      { coords: { clientX: 130 } },
    ]);
    expect(live()).toBe("250px");
    await user.pointer({ coords: { clientX: 160 } });
    expect(live()).toBe("280px");
    expect(onCommit).not.toHaveBeenCalled();

    await user.pointer({ keys: "[/MouseLeft]" });
    expect(onCommit.mock.calls).toEqual([[280, "drag"]]);
  });

  it("clamps the live and committed width to the range", async () => {
    const { handle, onCommit, live, user } = setup(220);
    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 100 } },
      { coords: { clientX: 2000 } },
    ]);
    expect(live()).toBe("480px");
    await user.pointer([{ coords: { clientX: -2000 } }, { keys: "[/MouseLeft]" }]);
    expect(live()).toBe("180px");
    expect(onCommit.mock.calls).toEqual([[180, "drag"]]);
  });

  it("a drag that ends where it began commits nothing", async () => {
    const { handle, onCommit, user } = setup(220);
    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 100 } },
      { coords: { clientX: 150 } },
      { coords: { clientX: 100 } },
      { keys: "[/MouseLeft]" },
    ]);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)(
    "%s ends the drag and keeps the last width, committed once",
    async (ending) => {
      const { handle, onCommit, user } = setup(220);
      await user.pointer([
        { keys: "[MouseLeft>]", target: handle, coords: { clientX: 100 } },
        { coords: { clientX: 140 } },
      ]);
      fireEvent[ending](handle);
      expect(onCommit.mock.calls).toEqual([[260, "drag"]]);
      await user.pointer([{ coords: { clientX: 300 } }, { keys: "[/MouseLeft]" }]);
      expect(onCommit.mock.calls).toEqual([[260, "drag"]]);
    },
  );

  it("a move with no press, or a secondary-button press, does nothing", async () => {
    const { handle, onCommit, live, user } = setup(220);
    await user.pointer({ target: handle, coords: { clientX: 300 } });
    await user.pointer([
      { keys: "[MouseRight>]", target: handle, coords: { clientX: 100 } },
      { coords: { clientX: 200 } },
      { keys: "[/MouseRight]" },
    ]);
    expect(live()).toBe("");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("double-click resets to the default", async () => {
    const { handle, onCommit, user } = setup(400);
    await user.dblClick(handle);
    expect(onCommit.mock.calls).toEqual([[220, "reset"]]);
  });

  it("double-click at the default commits nothing", async () => {
    const { handle, onCommit, user } = setup(220);
    await user.dblClick(handle);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
