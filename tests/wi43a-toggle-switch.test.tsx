/**
 * WI-4.3a: `ToggleSwitch`, the one on/off control every boolean setting uses
 * (E4). Written once, by role and with `userEvent` (E7): its name is the row
 * heading it points at, `aria-checked` follows the value, click and Space toggle
 * it, Tab reaches it, and disabled it ignores both.
 *
 * jsdom has no `:focus-visible`, so the focus ring is pinned by source
 * inspection of `settings-rows.css`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToggleSwitch } from "../src/components/common/ToggleSwitch";

const TITLE = "Word Wrap";

function Row({ initial = false, disabled = false, onChange }: {
  initial?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const [on, setOn] = useState(initial);
  return (
    <div>
      <button type="button">before</button>
      <h4 id="row-title">{TITLE}</h4>
      <p id="row-reason">Locked while saving</p>
      <ToggleSwitch
        labelledBy="row-title"
        describedBy={disabled ? "row-reason" : undefined}
        checked={on}
        disabled={disabled}
        onChange={(next) => {
          onChange(next);
          setOn(next);
        }}
      />
    </div>
  );
}

const sw = () => screen.getByRole("switch", { name: TITLE });

describe("WI-4.3a ToggleSwitch", () => {
  it("is a switch named by its row heading", () => {
    render(<Row onChange={() => {}} />);
    expect(sw()).toBeInTheDocument();
  });

  it("aria-checked follows the value it is given", () => {
    const { rerender } = render(<ToggleSwitch labelledBy="x" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    rerender(<ToggleSwitch labelledBy="x" checked onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("a click toggles it, and a second click toggles it back", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);
    await user.click(sw());
    expect(sw()).toHaveAttribute("aria-checked", "true");
    await user.click(sw());
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("Tab reaches it, it takes focus, and Space toggles it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);
    await user.tab();
    await user.tab();
    expect(sw()).toHaveFocus();
    await user.keyboard(" ");
    expect(sw()).toHaveAttribute("aria-checked", "true");
    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it("disabled, it ignores click and Space, and is described by its reason", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Row disabled onChange={onChange} />);
    await user.click(sw());
    sw().focus();
    await user.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
    expect(sw()).toHaveAttribute("aria-checked", "false");
    expect(sw()).toBeDisabled();
    expect(sw()).toHaveAccessibleDescription("Locked while saving");
  });

  it("renders its input inside label.toggle-switch, before the .toggle-slider the ring targets", () => {
    render(<ToggleSwitch labelledBy="x" checked={false} onChange={() => {}} />);
    const input = screen.getByRole("switch");
    expect(input.parentElement).toHaveClass("toggle-switch");
    expect(input.parentElement?.tagName).toBe("LABEL");
    expect(input.nextElementSibling).toHaveClass("toggle-slider");
  });

  it("the track draws the rule 33 ring when the input has keyboard focus", () => {
    const css = readFileSync(join(__dirname, "..", "src", "styles", "sections", "settings-rows.css"), "utf8");
    const block = css.match(/\.toggle-switch input:focus-visible \+ \.toggle-slider\s*\{([^}]*)\}/);
    expect(block?.[1]).toContain("outline: 2px solid var(--color-focus-ring)");
  });
});
