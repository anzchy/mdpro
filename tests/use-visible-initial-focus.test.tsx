/**
 * D63 — `useVisibleInitialFocus`, the shared "initial focus is one visible focus request"
 * hook extracted from ConfirmDialog (D53) for ReloadDialog and McpWriteConfirmDialog.
 *
 * Law (S5, idempotence across re-renders): while `enabled` stays true the hook requests
 * focus exactly once, however many times the host re-renders; each false → true transition
 * requests it exactly once more. VF-4 and VF-5 cover it; VF-1 … VF-3 and VF-6 are examples
 * and boundaries.
 *
 * jsdom has no `:focus-visible`; the spy records the focus requests (target + options) and
 * calls through, so `toHaveFocus` checks where focus actually landed. Mock boundary: none —
 * the spy wraps jsdom's real focus. The device check (WKWebView ring visible) proves the ring.
 */
import { createRef, useRef } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisibleInitialFocus } from "../src/hooks/useVisibleInitialFocus";

type FocusCall = { el: HTMLElement; options: FocusOptions | undefined };
let focusCalls: FocusCall[];
let focusSpy: { mockRestore: () => void } | null = null;

beforeEach(() => {
  focusCalls = [];
  const original = HTMLElement.prototype.focus;
  focusSpy = vi
    .spyOn(HTMLElement.prototype, "focus")
    .mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      focusCalls.push({ el: this, options });
      original.call(this, options);
    });
});

afterEach(() => {
  focusSpy?.mockRestore();
  focusSpy = null;
});

const visibleFlag = (c: FocusCall) => (c.options as { focusVisible?: boolean } | undefined)?.focusVisible;

/** A host with two buttons; the hook targets "Target". `label` lets a re-render change props. */
function Host({ enabled, label = "first" }: { enabled: boolean; label?: string }) {
  const targetRef = useRef<HTMLButtonElement>(null);
  useVisibleInitialFocus(targetRef, enabled);
  return (
    <div data-label={label}>
      <button type="button">Other</button>
      <button ref={targetRef} type="button">
        Target
      </button>
    </div>
  );
}

const target = () => screen.getByRole("button", { name: "Target" });
const other = () => screen.getByRole("button", { name: "Other" });

describe("useVisibleInitialFocus (D63)", () => {
  it("VF-1: enabled on mount — exactly one focus request, on the target, with focusVisible: true", () => {
    render(<Host enabled />);
    expect(focusCalls).toHaveLength(1);
    expect(focusCalls[0].el).toBe(target());
    expect(visibleFlag(focusCalls[0])).toBe(true);
    expect(target()).toHaveFocus();
  });

  it("VF-2: disabled — no focus request, focus stays on body", () => {
    render(<Host enabled={false} />);
    expect(focusCalls).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("VF-3: enabled later — the false → true transition requests visible focus once", () => {
    const view = render(<Host enabled={false} />);
    expect(focusCalls).toHaveLength(0);
    view.rerender(<Host enabled />);
    expect(focusCalls).toHaveLength(1);
    expect(focusCalls[0].el).toBe(target());
    expect(visibleFlag(focusCalls[0])).toBe(true);
    expect(target()).toHaveFocus();
  });

  it("VF-4: re-rendering while enabled does not refocus — a user's focus move is kept", () => {
    const view = render(<Host enabled />);
    expect(focusCalls).toHaveLength(1);

    act(() => {
      other().focus();
    });
    expect(other()).toHaveFocus();
    const afterMove = focusCalls.length;

    view.rerender(<Host enabled />);
    view.rerender(<Host enabled label="second" />);
    view.rerender(<Host enabled label="third" />);

    expect(focusCalls.slice(afterMove)).toStrictEqual([]);
    expect(other()).toHaveFocus();
  });

  it("VF-5: each false → true transition requests visible focus exactly once more", () => {
    const view = render(<Host enabled />);
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      expect(focusCalls).toHaveLength(cycle);
      view.rerender(<Host enabled={false} />);
      view.rerender(<Host enabled={false} label="closed again" />);
      expect(focusCalls).toHaveLength(cycle);
      view.rerender(<Host enabled />);
    }
    expect(focusCalls).toHaveLength(4);
    expect(focusCalls.every((c) => c.el === target() && visibleFlag(c) === true)).toBe(true);
  });

  it("VF-6: a ref with no element does not throw and requests nothing", () => {
    const empty = createRef<HTMLElement>();
    expect(() => renderHook(() => useVisibleInitialFocus(empty, true))).not.toThrow();
    expect(focusCalls).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
  });
});
