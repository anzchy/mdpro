/**
 * Purpose: pin the shipped Content-Security-Policy so the Tauri IPC custom
 * protocol is not refused in a packaged build (defect D5, BLOCK).
 *
 * Why this test exists
 * --------------------
 * `src-tauri/tauri.conf.json` declared `default-src 'self'` and no
 * `connect-src`. Tauri's injected IPC bridge does a real `fetch()` — see
 * `tauri-2.9.5/scripts/ipc-protocol.js`:
 *
 *     fetch(window.__TAURI_INTERNALS__.convertFileSrc(cmd, 'ipc'), { ... })
 *
 * so the request is governed by `connect-src`, which fell back to
 * `default-src 'self'`. The document origin in a packaged macOS app is
 * `tauri://localhost`, and `'self'` does not match a different scheme, so
 * every startup `invoke` was refused by the webview.
 *
 * Tauri does NOT paper over this: `tauri::manager::set_csp` only substitutes
 * script/style nonces and hashes — `connect-src` appears nowhere in the crate.
 * The CSP has to grant the IPC scheme explicitly.
 *
 * The app still worked, because `ipc-protocol.js` catches the rejection and
 * permanently falls back to `window.ipc.postMessage`. The costs were a burst
 * of console errors on every launch (each blocked fetch logs a WebKit CSP
 * refusal *and* Tauri's own `console.warn`) drowning real errors, plus one
 * wasted failed round-trip per in-flight startup command.
 *
 * This is only observable in a packaged build: `pnpm tauri dev` serves the
 * frontend from the Vite dev server, which never receives this CSP header.
 * That is precisely why it needs a test at the config level — no runtime
 * suite in this repo can reach the packaged surface.
 *
 * @module tests/tauri-csp-ipc-connect-src
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const root = resolve(__dirname, "..");
const tauriConf = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf-8"),
);
const csp: string = tauriConf.app.security.csp;

/**
 * The origin a packaged Tauri app's document is served from on macOS.
 * `'self'` is resolved against this, which is why it cannot cover `ipc:`.
 */
const DOCUMENT_ORIGIN = new URL("tauri://localhost/");

/**
 * Reimplementation of Tauri's `convertFileSrc`, copied from
 * `tauri-2.9.5/scripts/core.js`. Deriving the URL from the real algorithm —
 * rather than hardcoding a string — keeps this test honest if Tauri ever
 * changes the shape of the IPC endpoint.
 */
function convertFileSrc(
  filePath: string,
  protocol: string,
  osName: "macos" | "windows",
  protocolScheme = "http",
): string {
  const path = encodeURIComponent(filePath);
  return osName === "windows"
    ? `${protocolScheme}://${protocol}.localhost/${path}`
    : `${protocol}://localhost/${path}`;
}

/** Parse a CSP into directives. Per spec, a repeated directive is ignored. */
function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const segment of policy.split(";")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0].toLowerCase();
    if (!directives.has(name)) directives.set(name, tokens.slice(1));
  }
  return directives;
}

const directives = parseCsp(csp);

/** Resolve a fetch directive, applying the `default-src` fallback. */
function effectiveSources(name: string): { sources: string[]; from: string } {
  if (directives.has(name)) return { sources: directives.get(name)!, from: name };
  if (directives.has("default-src")) {
    return { sources: directives.get("default-src")!, from: "default-src" };
  }
  return { sources: [], from: "(unrestricted)" };
}

/** Does one CSP source expression match this URL? */
function sourceMatches(source: string, url: URL): boolean {
  if (source === "*") return true;
  if (source === "'self'") {
    return (
      url.protocol === DOCUMENT_ORIGIN.protocol &&
      url.host === DOCUMENT_ORIGIN.host
    );
  }
  // Other keyword-sources ('none', 'unsafe-inline', 'unsafe-eval', nonces,
  // hashes) never match a URL.
  if (source.startsWith("'")) return false;
  // scheme-source, e.g. `ipc:` or `data:`
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
    return url.protocol.toLowerCase() === source.toLowerCase();
  }
  // host-source, with or without a scheme, e.g. `http://ipc.localhost`
  const withScheme = source.includes("://") ? source : `//${source}`;
  let parsed: URL;
  try {
    parsed = new URL(
      withScheme.startsWith("//") ? `${url.protocol}${withScheme}` : withScheme,
    );
  } catch {
    return false;
  }
  return parsed.protocol === url.protocol && parsed.host === url.host;
}

function isAllowed(rawUrl: string, directive: string): boolean {
  const url = new URL(rawUrl);
  return effectiveSources(directive).sources.some((s) => sourceMatches(s, url));
}

describe("D5 — packaged CSP must permit the Tauri IPC custom protocol", () => {
  it("declares connect-src explicitly rather than inheriting default-src", () => {
    // Inheriting is exactly how the defect arose: `default-src 'self'` is a
    // sane default for everything *except* the IPC scheme.
    expect(effectiveSources("connect-src").from).toBe("connect-src");
  });

  it.each([
    ["open_file", "macos"],
    ["plugin:event|listen", "macos"],
  ] as const)("permits the macOS IPC endpoint for command %s", (cmd, os) => {
    const target = convertFileSrc(cmd, "ipc", os);
    expect(target.startsWith("ipc://localhost/")).toBe(true);
    expect(isAllowed(target, "connect-src")).toBe(true);
  });

  it("permits the Windows/Android IPC endpoint form", () => {
    const target = convertFileSrc("open_file", "ipc", "windows");
    expect(target).toBe("http://ipc.localhost/open_file");
    expect(isAllowed(target, "connect-src")).toBe(true);
  });

  it("does not grant the IPC scheme by loosening default-src", () => {
    // A 'fix' that adds `ipc:` to default-src would make this test green on
    // the cases above while widening every other fetch directive at once.
    expect(directives.get("default-src")).toEqual(["'self'"]);
  });

  it("does not open connect-src wider than the IPC protocol needs", () => {
    const { sources } = effectiveSources("connect-src");
    for (const forbidden of ["*", "http:", "https:", "data:", "blob:"]) {
      expect(sources).not.toContain(forbidden);
    }
    // Arbitrary remote origins must stay blocked — this app is local-only.
    expect(isAllowed("https://example.com/beacon", "connect-src")).toBe(false);
  });
});
