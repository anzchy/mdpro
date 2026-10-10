/**
 * D38R-WI-1 — `wouldReturnIntoGone(el, oldDom)` and `describeReturnFocus(el, oldDom,
 * liveDom)` from `useReturnFocusOnClose`: the questions the rebuilt editor's restore asks
 * when a confirm prompt holds focus but its capture saw no prompt (the write landed
 * before the next prompt existed).
 *
 * `wouldReturnIntoGone` is true only when the prompt holding `el` has nowhere live to go
 * AND what it lost was the old editor (or it never had a target): then handing it the
 * rebuilt view steals nothing. A connected prior anywhere, or a lost unrelated target
 * (the D38-G3 end fallback), keeps it false.
 *
 * No mocks: a real jsdom DOM; `Probe` stands in for the dialog (an autoFocus button).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import {
  describeReturnFocus,
  redirectReturnFocus,
  useReturnFocusOnClose,
  wouldReturnIntoGone,
} from "../src/hooks/useReturnFocusOnClose";

function Probe() {
  const container = useRef<HTMLDivElement>(null);
  useReturnFocusOnClose(container);
  return (
    <div ref={container}>
      <button type="button" autoFocus>
        prompt
      </button>
    </div>
  );
}

/** A focusable element appended to body (an editor `view.dom` stand-in, or an input). */
function focusable(tag: "div" | "input" = "div"): HTMLElement {
  const el = document.body.appendChild(document.createElement(tag));
  if (tag === "div") {
    el.tabIndex = 0;
    el.className = "ProseMirror";
  }
  return el;
}

/** Focus `from` (or body when null), open a prompt, return the prompt's focused button. */
function openPromptFrom(from: HTMLElement | null): HTMLElement {
  if (from) act(() => from.focus());
  else (document.activeElement as HTMLElement | null)?.blur();
  render(<Probe />);
  const btn = screen.getByRole("button", { name: "prompt" });
  expect(document.activeElement, "harness: the prompt holds focus").toBe(btn);
  return btn;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("wouldReturnIntoGone", () => {
  it("false when no open prompt holds the element", () => {
    const oldDom = focusable();
    const other = focusable("input");
    oldDom.remove();
    expect(wouldReturnIntoGone(other, oldDom)).toBe(false);
    expect(wouldReturnIntoGone(null, oldDom)).toBe(false);
  });

  it("true when the prompt was opened from body (no prior at all)", () => {
    const oldDom = focusable();
    oldDom.remove();
    expect(wouldReturnIntoGone(openPromptFrom(null), oldDom)).toBe(true);
  });

  it("true when the prompt's only prior is the old editor and it is gone", () => {
    const oldDom = focusable();
    const btn = openPromptFrom(oldDom);
    oldDom.remove();
    expect(wouldReturnIntoGone(btn, oldDom)).toBe(true);
  });

  it("false while the old editor is still connected (the prompt can return there itself)", () => {
    const oldDom = focusable();
    expect(wouldReturnIntoGone(openPromptFrom(oldDom), oldDom)).toBe(false);
  });

  it("false when another prior is still connected, even though the old editor is among the priors", () => {
    const oldDom = focusable();
    const input = focusable("input");
    const btn = openPromptFrom(oldDom);
    expect(redirectReturnFocus(btn, input), "harness: prepended").toBe(true);
    oldDom.remove();
    expect(wouldReturnIntoGone(btn, oldDom)).toBe(false);
  });

  it("false when the lost target is unrelated to the editor (the genuine end fallback)", () => {
    const oldDom = focusable();
    const gone = focusable("input");
    const btn = openPromptFrom(gone);
    gone.remove();
    oldDom.remove();
    expect(wouldReturnIntoGone(btn, oldDom)).toBe(false);
  });
});

describe("describeReturnFocus (log categories, no content)", () => {
  it("names a focus holder that is no prompt", () => {
    const oldDom = focusable();
    const live = focusable();
    const input = focusable("input");
    expect(describeReturnFocus(null, oldDom, live)).toEqual({ active: "body", promptTarget: "none" });
    expect(describeReturnFocus(document.body, oldDom, live)).toEqual({ active: "body", promptTarget: "none" });
    expect(describeReturnFocus(input, oldDom, live)).toEqual({ active: "other", promptTarget: "none" });
    expect(describeReturnFocus(oldDom, oldDom, live)).toEqual({ active: "editor", promptTarget: "none" });
  });

  it("classifies the prompt's return target: empty, old-editor, gone, live, other", () => {
    const live = focusable();
    const oldDom = focusable();
    const input = focusable("input");
    const fromBody = openPromptFrom(null);
    expect(describeReturnFocus(fromBody, oldDom, live)).toEqual({ active: "prompt", promptTarget: "empty" });
    cleanup();

    const fromOld = openPromptFrom(oldDom);
    oldDom.remove();
    expect(describeReturnFocus(fromOld, oldDom, live).promptTarget).toBe("old-editor");
    cleanup();

    const elsewhere = focusable("input");
    const fromGone = openPromptFrom(elsewhere);
    elsewhere.remove();
    expect(describeReturnFocus(fromGone, oldDom, live).promptTarget).toBe("gone");
    redirectReturnFocus(fromGone, live);
    expect(describeReturnFocus(fromGone, oldDom, live).promptTarget).toBe("live");
    cleanup();

    const fromInput = openPromptFrom(input);
    expect(describeReturnFocus(fromInput, oldDom, live).promptTarget).toBe("other");
  });
});
