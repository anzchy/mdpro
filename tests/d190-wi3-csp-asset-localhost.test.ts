// @vitest-environment node
/**
 * Purpose: pin the three pieces Tauri 2 needs to show local images, with the
 * CSP `img-src` covering the Windows asset origin (D190-WI-3, audit W3).
 *
 * Why this test exists
 * --------------------
 * `convertFileSrc()` yields `asset://localhost/<path>` on macOS/Linux but
 * `http://asset.localhost/<path>` on Windows (unless `useHttpsScheme` is set,
 * which mdpro does not set). The shipped `img-src` granted only `asset:` and
 * `https://asset.localhost`, so on Windows every local image was refused with
 * a `securitypolicyviolation` (img-src) — see
 * `docs/test/windows-audit-20261012-claude/run-notes.md`, row 044.
 *
 * The 2026-02-18 lesson in `progress.md` names three pieces that must stay in
 * sync; a missing one fails silently. This file pins all three, plus a guard
 * that the fix did not loosen the policy scheme-wide.
 *
 * Only a packaged build applies this CSP, so no runtime suite here reaches it.
 *
 * @module tests/d190-wi3-csp-asset-localhost
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const root = resolve(__dirname, "..");
const tauriConf = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf-8"),
);
const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf-8");
const csp: string = tauriConf.app.security.csp;

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
const imgSrc = directives.get("img-src") ?? [];

/** The `features = [...]` list on the `tauri = { ... }` dependency line. */
function tauriFeatures(toml: string): string[] {
  const line = toml.split("\n").find((l) => /^\s*tauri\s*=/.test(l));
  if (!line) return [];
  const list = /features\s*=\s*\[([^\]]*)\]/.exec(line);
  if (!list) return [];
  return [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("D190-WI-3 — local images render under the shipped CSP on every OS", () => {
  it("declares img-src explicitly", () => {
    expect(directives.has("img-src")).toBe(true);
  });

  it("img-src grants the Windows asset origin http://asset.localhost", () => {
    expect(imgSrc).toContain("http://asset.localhost");
  });

  it("img-src keeps the https://asset.localhost form (useHttpsScheme)", () => {
    expect(imgSrc).toContain("https://asset.localhost");
  });

  it.each(["'self'", "asset:", "data:"])("img-src keeps %s", (source) => {
    expect(imgSrc).toContain(source);
  });

  it("the asset protocol is enabled with a non-empty scope", () => {
    const assetProtocol = tauriConf.app.security.assetProtocol;
    expect(assetProtocol?.enable).toBe(true);
    expect(Array.isArray(assetProtocol?.scope)).toBe(true);
    expect(assetProtocol.scope.length).toBeGreaterThan(0);
  });

  it("the tauri dependency enables the protocol-asset feature", () => {
    expect(tauriFeatures(cargoToml)).toContain("protocol-asset");
  });

  it("no directive grants a wildcard or the whole http: scheme", () => {
    expect(directives.size).toBeGreaterThan(0);
    for (const [name, sources] of directives) {
      expect({ name, wildcard: sources.includes("*") }).toEqual({
        name,
        wildcard: false,
      });
      expect({ name, httpScheme: sources.includes("http:") }).toEqual({
        name,
        httpScheme: false,
      });
    }
  });
});
