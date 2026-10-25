/**
 * D317-WI-3 — every Encoding cancel writes one content-free line saying where focus
 * ended up, so a device run can tell `editor` from `other-control` from `none`:
 * `ui.dialog.focus-return` `{ controlId: "dialog.encoding.cancel", focus }`.
 *
 * Laws:
 * 1. Exactly one line per cancel (Escape, Cancel, backdrop), none for a retry choice
 *    or an external clear; `ui.dialog.cancel` / `ui.dialog.escape` stay one each.
 * 2. The value is where focus *is* when the line is written (after the return), not
 *    where the return meant to put it: a target whose `focus()` does nothing logs `none`.
 * 3. No path and no document text in the payload.
 *
 * Matrix: `~/.mdpro-redesign/herdr-spike/opus-imple-1/D317-test-matrix.md` § AC-3 (3.1–3.4),
 * Amendment r1 (3.6, 3.7).
 *
 * Mock boundary: core `invoke`; each `log_event` is recorded with the element that
 * held focus at that moment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type LogPayload = { event?: string; context?: Record<string, unknown> };
type Logged = { payload: LogPayload; active: Element | null };
const { logs } = vi.hoisted(() => ({ logs: [] as Array<{ payload: LogPayload; active: Element | null }> }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args?: { payload?: LogPayload }) => {
    if (cmd === "log_event") logs.push({ payload: args?.payload ?? {}, active: document.activeElement });
    return Promise.resolve(null);
  },
}));

import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import {
  activate, createEncodingParent, mountCm, mountPm, otherModal, outsideButton,
  resetD317World, shimRangeLayout,
} from "./support/d317EditorFixtures";

const EVENT = "ui.dialog.focus-return";
const dialog = () => screen.queryByRole("dialog", { name: "Select encoding" });
const lines = (): Logged[] => logs.filter((l) => l.payload.event === EVENT);
const blurToBody = () => act(() => (document.activeElement as HTMLElement | null)?.blur());

beforeEach(() => {
  shimRangeLayout();
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

afterEach(() => {
  resetD317World();
});

type Close = (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
const CLOSES: Array<[string, Close]> = [
  ["Escape", async (user) => user.keyboard("{Escape}")],
  ["Cancel", async (user) => user.click(screen.getByRole("button", { name: "Cancel" }))],
  ["backdrop", async (user) => user.click(dialog()!.parentElement!)],
];

describe("D317-WI-3 focus-return outcome line", () => {
  it.each(CLOSES)("3.1 WYSIWYG, %s from the editor: one `editor` line, written after the return and after the cancel line", async (_n, close) => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Secret body text", 3, 8);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    await close(user);
    const out = lines();
    expect(out).toHaveLength(1);
    expect(out[0].payload.context).toEqual({ controlId: "dialog.encoding.cancel", focus: "editor" });
    expect(out[0].active).toBe(pm.view.dom);
    const events = logs.map((l) => l.payload.event);
    expect(events.indexOf("ui.dialog.cancel")).toBeLessThan(events.indexOf(EVENT));
    expect(events.filter((e) => e === "ui.dialog.cancel")).toHaveLength(1);
  });

  it("3.1 Source, opened from <body> (B4): one `editor` line with the content in focus", async () => {
    const user = userEvent.setup();
    activate("doc-1", "source");
    const cm = mountCm("doc-1", "Secret body text", 2);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.keyboard("{Escape}");
    const out = lines();
    expect(out.map((l) => l.payload.context)).toEqual([{ controlId: "dialog.encoding.cancel", focus: "editor" }]);
    expect(out[0].active).toBe(cm.view.contentDOM);
  });

  it("3.2 focus moved to another control: `other-control`", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const elsewhere = outsideButton();
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    act(() => elsewhere.focus());
    await user.keyboard("{Escape}");
    expect(lines().map((l) => l.payload.context?.focus)).toEqual(["other-control"]);
    expect(lines()[0].active).toBe(elsewhere);
  });

  it("3.3 no active document: `none`", async () => {
    const user = userEvent.setup();
    activate(null, "wysiwyg");
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.keyboard("{Escape}");
    expect(lines().map((l) => l.payload.context?.focus)).toEqual(["none"]);
    expect(lines()[0].active === null || lines()[0].active === document.body).toBe(true);
  });

  it("3.3 the view closed while open: `none`", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    pm.destroy();
    await user.keyboard("{Escape}");
    expect(lines().map((l) => l.payload.context?.focus)).toEqual(["none"]);
  });

  it("3.3 another modal beneath: `none`", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    mountPm("doc-1", "Hello world", 3);
    otherModal();
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(lines().map((l) => l.payload.context?.focus)).toEqual(["none"]);
  });

  it("3.7 the target's focus() does nothing: the line says `none`, not what was attempted", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    controls.open();
    blurToBody();
    vi.spyOn(pm.view, "focus").mockImplementation(() => {});
    vi.spyOn(pm.view.dom, "focus").mockImplementation(() => {});
    await user.keyboard("{Escape}");
    expect(lines().map((l) => l.payload.context?.focus)).toEqual(["none"]);
  });

  it("3.4 the line carries no path and no document text", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Secret body text", 3);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    await user.keyboard("{Escape}");
    expect(lines()).toHaveLength(1);
    const json = JSON.stringify(lines()[0].payload);
    expect(json).not.toContain("secret-名");
    expect(json).not.toContain("/x/");
    expect(json).not.toContain("Secret body");
  });

  it("1 a retry choice and an external clear write no focus-return line", async () => {
    const user = userEvent.setup();
    activate("doc-1", "wysiwyg");
    const pm = mountPm("doc-1", "Hello world", 3);
    const { EncodingParent, controls } = createEncodingParent();
    render(<EncodingParent />);
    act(() => pm.view.focus());
    controls.open();
    await user.click(screen.getByRole("button", { name: /UTF-16LE/ }));
    controls.open();
    controls.clear();
    expect(lines()).toHaveLength(0);
  });
});
