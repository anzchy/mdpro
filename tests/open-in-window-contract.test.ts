/**
 * WI-7 (D29) — the `file:open-in-window` event name is a string that crosses
 * the Rust/TS boundary. Nothing type-checks it: Rust emits it from
 * `src-tauri/src/services/open_route/`, and `useOpenInWindow.ts` listens for
 * it. A rename on one side would silently drop every routed open, so this
 * contract reads both sources and compares the extracted literals.
 *
 * On red/green honesty: both constants already matched when this test was
 * written, so there was no natural red. The red was demonstrated by mutation
 * (a wrong expected literal), not recorded against production code.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OPEN_ROUTE_DIR = "src-tauri/src/services/open_route";
const TS_HOOK = "src/hooks/useOpenInWindow.ts";
const EXPECTED_EVENT = "file:open-in-window";
const ROUTE_LOG_LITERAL = '"file.open.route"';

/** Production Rust files only: test modules and the lookup fixture are skipped. */
function rustSourceFiles(): string[] {
  return readdirSync(OPEN_ROUTE_DIR)
    .filter((name) => name.endsWith(".rs"))
    .filter((name) => !name.endsWith("_tests.rs"))
    .filter((name) => name !== "lookup_fixture.rs")
    .sort()
    .map((name) => join(OPEN_ROUTE_DIR, name));
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function extractRustEvent(source: string): string | null {
  const match = source.match(
    /OPEN_IN_WINDOW_EVENT\s*:\s*&(?:'static\s+)?str\s*=\s*"([^"]*)"/,
  );
  return match ? match[1] : null;
}

function extractTsEvent(source: string): string | null {
  const match = source.match(
    /export\s+const\s+OPEN_IN_WINDOW_EVENT\s*(?::\s*string\s*)?=\s*["']([^"']*)["']/,
  );
  return match ? match[1] : null;
}

const TS_MCP_SERVICE = "src/services/mcpService.ts";
const RUST_MCP_MODELS = "src-tauri/src/models/mcp.rs";

/** The body of `export interface SyncDocumentsPayload { … }`, or null. */
function extractTsSyncPayload(source: string): string | null {
  const match = source.match(/export\s+interface\s+SyncDocumentsPayload\s*\{([\s\S]*?)\n\}/);
  return match ? match[1] : null;
}

/** The attributes before, and the body of, `pub struct SyncDocumentsPayload { … }`, or null. */
function extractRustSyncPayload(source: string): { attrs: string; body: string } | null {
  const match = source.match(/((?:#\[[^\]]*\]\s*)*)pub\s+struct\s+SyncDocumentsPayload\s*\{([\s\S]*?)\n\}/);
  return match ? { attrs: match[1], body: match[2] } : null;
}

const snakeToCamel = (name: string): string => name.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * The JSON key serde reads for a Rust field: an explicit `#[serde(rename = "…")]`
 * on the field wins, then the struct's `rename_all = "camelCase"`, else the name.
 */
function rustWireKey(attrs: string, body: string, field: string): string | null {
  const fieldMatch = body.match(new RegExp(`((?:#\\[[^\\]]*\\]\\s*)*)pub\\s+${field}\\s*:`));
  if (!fieldMatch) return null;
  const explicit = fieldMatch[1].match(/rename\s*=\s*"([^"]*)"/);
  if (explicit) return explicit[1];
  return /rename_all\s*=\s*"camelCase"/.test(attrs) ? snakeToCamel(field) : field;
}

describe("open-in-window contract (Rust ↔ TS)", () => {
  it("event name and log event match across Rust and TS", () => {
    const rustFiles = rustSourceFiles();
    // Guard against a vacuous run: the directory must yield real sources,
    // including the one that declares the event constant.
    expect(rustFiles.length).toBeGreaterThan(0);
    expect(rustFiles).toContain(join(OPEN_ROUTE_DIR, "payload.rs"));

    const rustUnion = rustFiles.map(read).join("\n");
    const tsSource = read(TS_HOOK);

    const rustEvent = extractRustEvent(rustUnion);
    const tsEvent = extractTsEvent(tsSource);

    // Non-null first, so `undefined === undefined` cannot pass.
    expect(rustEvent).not.toBeNull();
    expect(tsEvent).not.toBeNull();

    expect(rustEvent).toBe(tsEvent);
    expect(rustEvent).toBe(EXPECTED_EVENT);
    expect(tsEvent).toBe(EXPECTED_EVENT);

    expect(rustUnion).toContain(ROUTE_LOG_LITERAL);
    expect(tsSource).toContain(ROUTE_LOG_LITERAL);
  });

  it("no console.log / println! / eprintln! in the open-route sources", () => {
    const files = [...rustSourceFiles(), TS_HOOK];
    expect(files.length).toBeGreaterThan(1);

    const offenders = files.filter((path) =>
      /console\.log|\bprintln!|\beprintln!/.test(read(path)),
    );
    expect(offenders).toEqual([]);
  });

  it("SyncDocumentsPayload.routable: the key TS sends is the key Rust reads", () => {
    const tsBody = extractTsSyncPayload(read(TS_MCP_SERVICE));
    const rust = extractRustSyncPayload(read(RUST_MCP_MODELS));
    // Non-null first, so a missing struct cannot pass vacuously.
    expect(tsBody).not.toBeNull();
    expect(rust).not.toBeNull();

    const tsField = tsBody!.match(/^\s*(routable)\s*:\s*boolean\s*;/m);
    expect(tsField).not.toBeNull();
    const rustKey = rustWireKey(rust!.attrs, rust!.body, "routable");
    expect(rustKey).not.toBeNull();

    expect(rustKey).toBe(tsField![1]);
    expect(rust!.body).toMatch(/pub\s+routable\s*:\s*bool\s*,/);
  });
});
