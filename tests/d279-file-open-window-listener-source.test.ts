// @vitest-environment node
/**
 * D279-WI-4, source pins over every file in `src/`: nothing subscribes to
 * `file:open` through the global `listen` of `@tauri-apps/api/event`, nothing
 * of the fail-open focus gate (`shouldHandleWindowEvent`, `isFocused`) survives,
 * and App wires `useFileOpenEvent` with the store setter. Matrix:
 * `.claude/tdd-guardian/tests-20261018-100701.md`, SP-L12a, SP-L12b, SP-1.
 * Modelled on `tests/d261-menu-target-routing-source.test.ts`.
 *
 * Why a text pin: a global (`Any`) listener matches every targeted emit
 * (tauri `event/listener.rs:346-351`), so one stray global subscriber would
 * undo Rust's `emit_to` in every window. jsdom cannot run two webviews and no
 * test renders App (waiver: tests/large-document-guard-call-site.test.ts); the
 * behaviour is in `tests/useFileOpenEvent.test.ts`, the real path is device
 * D279-a. Below Level 6, a supplement.
 *
 * Law L12 (S4, over every `src/**\/*.{ts,tsx}` file, comments stripped): every
 * `listen("file:open"` is on `getCurrentWindow()`.
 *
 * Residual risk: aliasing `getCurrentWindow()` to a local, or an event-name
 * constant, evades the window regex and then fails the count (accepted).
 *
 * Mock boundary: none.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const MIN_FILES = 100;
const APP = join("src", "App.tsx");
const HOOK = join("src", "hooks", "useFileOpenEvent.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Strip block and line comments, keeping strings intact enough for these pins. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const files = walk(SRC).map((path) => ({ rel: relative(ROOT, path), code: stripComments(readFileSync(path, "utf8")) }));
const fileAt = (rel: string) => files.find((f) => f.rel === rel);

const LISTEN_FILE_OPEN = /\blisten\s*(<[^>]*>)?\s*\(\s*["']file:open["']/g;
const WINDOW_LISTEN_FILE_OPEN = /getCurrentWindow\(\)\s*\.\s*listen\s*(<[^>]*>)?\s*\(\s*["']file:open["']/g;
const countOf = (code: string, re: RegExp) => (code.match(re) ?? []).length;

describe("SP-L12a every file:open subscriber in src is window-scoped (S4)", () => {
  it(`scans at least ${MIN_FILES} files (non-vacuity)`, () => {
    expect(files.length).toBeGreaterThanOrEqual(MIN_FILES);
  });

  it('every listen("file:open") call is on getCurrentWindow()', () => {
    const offenders = files.filter(
      ({ code }) => countOf(code, LISTEN_FILE_OPEN) !== countOf(code, WINDOW_LISTEN_FILE_OPEN),
    );
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("useFileOpenEvent.ts holds the one window-scoped subscription", () => {
    const hook = fileAt(HOOK);
    expect(hook, "useFileOpenEvent.ts present").toBeDefined();
    expect(countOf(hook!.code, WINDOW_LISTEN_FILE_OPEN)).toBe(1);
  });

  it("App.tsx no longer subscribes to file:open itself", () => {
    const app = fileAt(APP);
    expect(app, "App.tsx present").toBeDefined();
    expect(countOf(app!.code, LISTEN_FILE_OPEN)).toBe(0);
    expect(countOf(app!.code, WINDOW_LISTEN_FILE_OPEN)).toBe(0);
  });
});

describe("SP-L12b the fail-open focus gate is gone (S4)", () => {
  it("no file contains shouldHandleWindowEvent", () => {
    expect(files.filter(({ code }) => code.includes("shouldHandleWindowEvent")).map((f) => f.rel)).toEqual([]);
  });

  it.each([APP, HOOK])("%s asks no focus question", (rel) => {
    const file = fileAt(rel);
    expect(file, `${rel} present`).toBeDefined();
    expect(file!.code).not.toMatch(/\bisFocused\b/);
  });

  it("App.tsx imports nothing from @tauri-apps/api/event", () => {
    expect(fileAt(APP)!.code).not.toMatch(/from\s+["']@tauri-apps\/api\/event["']/);
  });
});

describe("SP-1 App calls useFileOpenEvent once, with the store setter (S1)", () => {
  it("one call, passing defaultViewMode, openPaths and setViewMode, never the user adapter (D24)", () => {
    const code = fileAt(APP)!.code;
    expect(code.split("useFileOpenEvent(").length - 1, "useFileOpenEvent( occurrences").toBe(1);
    const start = code.indexOf("useFileOpenEvent(");
    const end = code.indexOf(")", start + "useFileOpenEvent(".length);
    expect(end, "end of the call").toBeGreaterThan(start);
    const args = code.slice(start, end);
    expect(args).toMatch(/\bdefaultViewMode\b/);
    expect(args).toMatch(/\bopenPaths\b/);
    expect(args).toMatch(/\bsetViewMode\b/);
    expect(args).not.toMatch(/userViewModeCommands/);
    expect(args).not.toMatch(/["']user["']/);
  });
});
