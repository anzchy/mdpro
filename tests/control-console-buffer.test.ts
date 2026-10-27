import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rust = readFileSync(resolve("src-tauri/src/services/control_channel/page.rs"), "utf8");
const script = rust.match(/pub const INIT_SCRIPT: &str = r##"([\s\S]*?)"##;/)?.[1];
const probeScript = rust.match(/const PROBE: &str = r##"([\s\S]*?)"##;/)?.[1];

function probeConsole() {
  if (!probeScript) throw new Error("probe script missing");
  const probe = window.eval(`(${probeScript})`) as (args: object) => { console: { entries: Array<{ sequence: number; source: string; text: string }>; overflow: number; capacity: number } };
  return probe({}).console;
}

declare global {
  interface Window {
    __mdproConsole: { entries: Array<{ sequence: number; source: string; text: string }>; overflow: number; capacity: number };
  }
}

function install() {
  if (!script) throw new Error("console init script missing");
  window.eval(script);
  return (window as Window & { __mdproConsole: { entries: Array<{ sequence: number; source: string; text: string }>; overflow: number; capacity: number } }).__mdproConsole;
}

describe("control console buffer", () => {
  // The document-start global is deliberately reset between isolated jsdom cases.
  // @ts-expect-error test reset removes a required runtime-injected property
  beforeEach(() => { delete (window as Window & { __mdproConsole?: unknown }).__mdproConsole; });

  it("captures all four sources before app mount and preserves console methods", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const buffer = install();
    console.error("中文");
    console.warn("");
    window.dispatchEvent(new ErrorEvent("error", { message: "early" }));
    const rejected = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejected, "reason", { value: "rejected" });
    window.dispatchEvent(rejected);
    expect(buffer.entries.map(({ source, text, sequence }) => [source, text, sequence])).toEqual([
      ["console.error", "中文", 1], ["console.warn", "", 2], ["error", "early", 3], ["unhandledrejection", "rejected", 4],
    ]);
    expect(error).toHaveBeenCalledWith("中文");
    expect(warn).toHaveBeenCalledWith("");
    error.mockRestore(); warn.mockRestore();
  });

  it("retains newest capacity entries and counts overflow without resetting on read", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const buffer = install();
    for (let i = 0; i < buffer.capacity + 3; i++) console.error(String(i));
    expect(buffer.entries).toHaveLength(buffer.capacity);
    expect(buffer.entries[0].sequence).toBe(4);
    expect(buffer.overflow).toBe(3);
    console.error("later");
    expect(buffer.entries.at(-1)?.sequence).toBe(buffer.capacity + 4);
    expect(buffer.overflow).toBe(4);
    error.mockRestore();
  });

  it("keeps an early error through shell mount and repeated probe reads, then counts eviction", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = "";
    const buffer = install();
    window.dispatchEvent(new ErrorEvent("error", { message: "before mount" }));
    document.body.innerHTML = '<div class="app-shell" aria-busy="false" data-view-mode="source"></div>';
    expect(probeConsole().entries).toEqual([{ sequence: 1, source: "error", text: "before mount" }]);
    expect(probeConsole().entries).toEqual([{ sequence: 1, source: "error", text: "before mount" }]);

    for (let i = 0; i < buffer.capacity + 2; i++) console.error(`later-${i}`);
    const first = probeConsole();
    expect(first.entries).toHaveLength(buffer.capacity);
    expect(first.entries.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: buffer.capacity }, (_, i) => i + 4),
    );
    expect(first.overflow).toBe(3);
    console.error("last");
    const second = probeConsole();
    expect(second.entries.at(-1)).toEqual({ sequence: buffer.capacity + 4, source: "console.error", text: "last" });
    expect(second.overflow).toBe(4);
    expect(probeConsole()).toEqual(second);
    error.mockRestore();
  });
});
