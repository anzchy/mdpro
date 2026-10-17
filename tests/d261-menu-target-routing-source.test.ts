// @vitest-environment node
/**
 * D261-WI-1c, source pins over every file in `src/`: nothing subscribes to
 * `menu:action` through the global `listen` of `@tauri-apps/api/event`, and
 * nothing of the fail-open focus gate survives.
 *
 * Why a text pin: a global (`Any`) listener matches every targeted emit
 * (tauri `event/listener.rs:346-351`), so one stray global subscriber would
 * undo `emit_to` in every window. jsdom cannot run two webviews, so the
 * behavioural cases model the routing; this pins that no other path exists.
 *
 * Law (S4, over every `src/**\/*.{ts,tsx}` file): no `listen("menu:action"`
 * call except on `getCurrentWindow()`, and no `ui.menu.focus_check`,
 * `FOCUS_CHECK_FAIL_REASON` or `shouldHandleMenuAction`.
 *
 * Mock boundary: none.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const MIN_FILES = 100;

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

const LISTEN_MENU = /\blisten\s*(<[^>]*>)?\s*\(\s*["']menu:action["']/g;
const WINDOW_LISTEN_MENU = /getCurrentWindow\(\)\s*\.\s*listen\s*(<[^>]*>)?\s*\(\s*["']menu:action["']/g;

describe("no global menu:action subscriber in src (S4)", () => {
  it(`scans at least ${MIN_FILES} files (non-vacuity)`, () => {
    expect(files.length).toBeGreaterThanOrEqual(MIN_FILES);
  });

  it("every listen(\"menu:action\") call is on getCurrentWindow()", () => {
    const offenders = files.filter(
      ({ code }) => (code.match(LISTEN_MENU) ?? []).length !== (code.match(WINDOW_LISTEN_MENU) ?? []).length,
    );
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("useMenuEvents subscribes on the window and imports no listen from the event module", () => {
    const hook = files.find((f) => f.rel === join("src", "hooks", "useMenuEvents.ts"));
    expect(hook, "useMenuEvents.ts present").toBeDefined();
    expect(hook?.code.match(WINDOW_LISTEN_MENU) ?? []).toHaveLength(1);
    expect(hook?.code).not.toMatch(/from\s+["']@tauri-apps\/api\/event["']/);
  });
});

describe("the fail-open focus gate is gone from src (S4)", () => {
  it.each(["ui.menu.focus_check", "FOCUS_CHECK_FAIL_REASON", "shouldHandleMenuAction"])("no file contains %s", (needle) => {
    expect(files.filter(({ code }) => code.includes(needle)).map((f) => f.rel)).toEqual([]);
  });

  it("useMenuEvents asks no focus question", () => {
    const hook = files.find((f) => f.rel === join("src", "hooks", "useMenuEvents.ts"));
    expect(hook?.code).not.toMatch(/\bisFocused\b/);
  });
});
