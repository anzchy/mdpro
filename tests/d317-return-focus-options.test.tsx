/**
 * D317 — the two opt-in options `useReturnFocusOnClose` gained for the Encoding
 * dialog, at the hook's own level (the D317 dialog suites cover them only through
 * Encoding):
 *
 * - `acceptPrior` false skips that saved element and moves on to the next saved one
 *   (a queued dialog's inherited prior), not straight to the fallback.
 * - `shouldReturn` false skips the return entirely: no prior, no fallback call.
 *
 * No mocks: a real jsdom DOM, as in `use-return-focus-on-close.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useReturnFocusOnClose, type ReturnFocusOptions, type FocusFallback } from "../src/hooks/useReturnFocusOnClose";

function Probe({ label, fallback, options }: { label: string; fallback?: FocusFallback; options?: ReturnFocusOptions }) {
  const container = useRef<HTMLDivElement>(null);
  useReturnFocusOnClose(container, fallback, options);
  return (
    <div ref={container}>
      <button type="button" autoFocus>
        {label}
      </button>
    </div>
  );
}

function outsideButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  button.setAttribute("data-outside", "");
  document.body.appendChild(button);
  return button;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-outside]").forEach((n) => n.remove());
  (document.activeElement as HTMLElement | null)?.blur?.();
});

describe("D317 useReturnFocusOnClose options", () => {
  it("acceptPrior false skips that element and takes the next saved prior, not the fallback", () => {
    const opener = outsideButton("opener");
    opener.focus();
    const first = render(<Probe label="first" />);
    // The second dialog opens from the first one's button, so it inherits `opener`.
    const fallback = vi.fn(() => null);
    const rejectFirstsButton = (el: HTMLElement) => el.textContent !== "first";
    const second = render(<Probe label="second" fallback={fallback} options={{ acceptPrior: rejectFirstsButton }} />);
    second.unmount();
    expect(opener).toHaveFocus();
    expect(fallback).not.toHaveBeenCalled();
    first.unmount();
  });

  it("acceptPrior rejecting every saved element falls back", () => {
    const opener = outsideButton("opener");
    const target = outsideButton("target");
    opener.focus();
    const fallback = vi.fn(() => target);
    const probe = render(<Probe label="dialog" fallback={fallback} options={{ acceptPrior: () => false }} />);
    probe.unmount();
    expect(target).toHaveFocus();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("shouldReturn false returns nothing and never calls the fallback", () => {
    const opener = outsideButton("opener");
    opener.focus();
    const fallback = vi.fn(() => opener);
    const probe = render(<Probe label="dialog" fallback={fallback} options={{ fromBody: true, shouldReturn: () => false }} />);
    probe.unmount();
    expect(opener).not.toHaveFocus();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("shouldReturn is read at close, from the latest render", () => {
    const opener = outsideButton("opener");
    opener.focus();
    const probe = render(<Probe label="dialog" options={{ shouldReturn: () => false }} />);
    probe.rerender(<Probe label="dialog" options={{ shouldReturn: () => true }} />);
    probe.unmount();
    expect(opener).toHaveFocus();
  });
});
