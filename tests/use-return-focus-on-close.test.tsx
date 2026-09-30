/**
 * D37 WI-6 — `useReturnFocusOnClose(containerRef, fallback?)`, cases RF-1..RF-9 of
 * `.claude/tdd-guardian/tests-20260930-233000.md` (§"Unit: useReturnFocusOnClose", RF-4
 * widened and RF-8 from adversary round 1 Gap 8, RF-9 from "Gap 2 decided" / "(a)
 * amended"), plus RF-10 (a prior element inside a hook container that stays open).
 *
 * No mocks: a real jsdom DOM. `Probe` stands in for a dialog — a container with an
 * `autoFocus` button that steals focus on mount, exactly as the confirm dialog's Reject
 * button does. A component (not `renderHook`) so the ref is the container's own ref and
 * `key` can be swapped (RF-7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import {
  useReturnFocusOnClose,
  type FocusFallback,
} from "../src/hooks/useReturnFocusOnClose";

function Probe({ label = "steal", fallback }: { label?: string; fallback?: FocusFallback }) {
  const container = useRef<HTMLDivElement>(null);
  useReturnFocusOnClose(container, fallback);
  return (
    <div ref={container} data-testid="container">
      <button type="button" autoFocus>
        {label}
      </button>
    </div>
  );
}

/** Append `html` to the body, outside anything React renders. */
function outside(html: string): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-testid", "outside");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function focusPrior(): HTMLInputElement {
  outside(`<input aria-label="prior" />`);
  const prior = screen.getByRole<HTMLInputElement>("textbox", { name: "prior" });
  prior.focus();
  expect(document.activeElement, "harness: prior focused").toBe(prior);
  return prior;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-testid=outside]").forEach((n) => n.remove());
  (document.activeElement as HTMLElement | null)?.blur?.();
  vi.restoreAllMocks();
});

describe("useReturnFocusOnClose", () => {
  it("RF-1 the prior element is captured before the autoFocus child steals focus", () => {
    const prior = focusPrior();
    const { unmount } = render(<Probe />);
    expect(document.activeElement, "precondition: steal has focus").toBe(
      screen.getByRole("button", { name: "steal" }),
    );
    unmount();
    expect(document.activeElement).toBe(prior);
  });

  it("RF-2 restores on unmount with preventScroll", () => {
    const prior = focusPrior();
    const spy = vi.spyOn(prior, "focus");
    const { unmount } = render(<Probe />);
    unmount();
    expect(document.activeElement).toBe(prior);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("RF-3 a disconnected prior element is skipped with no throw", () => {
    const prior = focusPrior();
    const spy = vi.spyOn(prior, "focus");
    const { unmount } = render(<Probe />);
    prior.remove();
    expect(() => unmount()).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it.each([
    ["input", `<input aria-label="other" />`, "textbox"],
    ["button", `<button type="button">other</button>`, "button"],
    ["contenteditable", `<div role="textbox" aria-label="other" contenteditable="true"></div>`, "textbox"],
  ] as const)("RF-4 focus moved outside the container (%s) is left alone", (_kind, html, role) => {
    focusPrior();
    const { unmount } = render(<Probe />);
    outside(html);
    const other = screen.getByRole(role, { name: "other" });
    other.focus();
    expect(document.activeElement, "harness: other focused").toBe(other);
    unmount();
    expect(document.activeElement).toBe(other);
  });

  it("RF-5 no prior element (body): nothing is focused, a second cleanup is a no-op", () => {
    expect(document.activeElement, "harness: nothing focused").toBe(document.body);
    const bodyFocus = vi.spyOn(document.body, "focus");
    const { unmount } = render(<Probe />);
    expect(() => unmount()).not.toThrow();
    expect(() => cleanup()).not.toThrow();
    expect(document.activeElement).toBe(document.body);
    expect(bodyFocus).not.toHaveBeenCalled();
  });

  it("RF-6 focus fell to body during the lifetime: close still restores", () => {
    const prior = focusPrior();
    const { unmount } = render(<Probe />);
    screen.getByRole("button", { name: "steal" }).remove();
    expect(document.activeElement, "harness: focus fell to body").toBe(document.body);
    unmount();
    expect(document.activeElement).toBe(prior);
  });

  it("RF-7 a keyed remount chain returns to the original prior element (F6)", () => {
    const prior = focusPrior();
    const { rerender, unmount } = render(<Probe key="r1" label="steal r1" />);
    const r1 = screen.getByRole("button", { name: "steal r1" });
    expect(document.activeElement, "harness: r1 has focus").toBe(r1);
    rerender(<Probe key="r2" label="steal r2" />);
    expect(document.activeElement, "harness: r2 has focus").toBe(
      screen.getByRole("button", { name: "steal r2" }),
    );
    unmount();
    expect(document.activeElement).toBe(prior);
  });

  it("RF-8 a prior button inside a role=dialog that stays mounted gets focus back", () => {
    outside(`<div role="dialog" aria-label="settings"><button type="button">Keep</button></div>`);
    const keep = screen.getByRole("button", { name: "Keep" });
    keep.focus();
    const { unmount } = render(<Probe />);
    unmount();
    expect(document.activeElement).toBe(keep);
  });

  describe("RF-9 fallback when the prior element is gone", () => {
    it("focuses the live element the fallback returns", () => {
      const prior = focusPrior();
      const target = outside(`<button type="button">target</button>`).querySelector("button")!;
      const fallback = vi.fn(() => target);
      const { unmount } = render(<Probe fallback={fallback} />);
      prior.remove();
      unmount();
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(target);
    });

    it.each([
      ["undefined", undefined],
      ["returning null", () => null],
    ] as const)("fallback %s: body, no throw", (_kind, fallback) => {
      const prior = focusPrior();
      const { unmount } = render(<Probe fallback={fallback} />);
      prior.remove();
      expect(() => unmount()).not.toThrow();
      expect(document.activeElement).toBe(document.body);
    });

    it("a throwing fallback is contained", () => {
      const prior = focusPrior();
      const { unmount } = render(
        <Probe
          fallback={() => {
            throw new Error("boom");
          }}
        />,
      );
      prior.remove();
      expect(() => unmount()).not.toThrow();
    });

    it("focus moved outside before close: the fallback is not called", () => {
      const prior = focusPrior();
      const fallback = vi.fn(() => null);
      const { unmount } = render(<Probe fallback={fallback} />);
      prior.remove();
      outside(`<input aria-label="other" />`);
      const other = screen.getByRole("textbox", { name: "other" });
      other.focus();
      unmount();
      expect(fallback).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(other);
    });

    it("a connected prior element wins: the fallback is not called", () => {
      const prior = focusPrior();
      const fallback = vi.fn(() => null);
      const { unmount } = render(<Probe fallback={fallback} />);
      unmount();
      expect(fallback).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(prior);
    });

    it("no prior element at open (body): the fallback is not called", () => {
      const fallback = vi.fn(() => null);
      const { unmount } = render(<Probe fallback={fallback} />);
      unmount();
      expect(fallback).not.toHaveBeenCalled();
    });
  });

  it("RF-10 a prior element inside another hook container that stays open gets focus back", () => {
    focusPrior();
    render(<Probe label="outer" />);
    const outer = screen.getByRole("button", { name: "outer" });
    expect(document.activeElement, "harness: outer has focus").toBe(outer);
    const inner = render(<Probe label="inner" />);
    expect(document.activeElement, "harness: inner has focus").toBe(
      screen.getByRole("button", { name: "inner" }),
    );
    inner.unmount();
    expect(document.activeElement).toBe(outer);
  });
});
