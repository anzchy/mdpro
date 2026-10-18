// @vitest-environment node
/**
 * D274-WI-1: the `zip` crate stays out of mdpro's dependency tree (ADR-0122;
 * user, 2026-10-18: 「去掉 zip 这个 crate，停止codex评估」).
 *
 * `zip` 4.6.1 carried RUSTSEC-2026-0367/0368/0369 and came in only through
 * tauri-plugin-updater's default `zip` feature, which exists for Tauri v1
 * update bundles mdpro never publishes. The updater is therefore declared
 * with `default-features = false` and exactly the other defaults
 * (`rustls-tls`, `system-proxy`). Cargo.lock lists every target's packages,
 * so a `zip` entry there means some platform's build pulls it back in.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const manifest = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
const lock = fs.readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8");

/** The right-hand side of `tauri-plugin-updater = …` under [dependencies]. */
function updaterSpec(): string {
  return /^tauri-plugin-updater\s*=\s*(.+)$/m.exec(manifest)?.[1]?.trim() ?? "";
}

function updaterFeatures(): string[] {
  const list = /features\s*=\s*\[([^\]]*)\]/.exec(updaterSpec())?.[1] ?? "";
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

function lockPackages(): { name: string; body: string }[] {
  return lock
    .split("[[package]]")
    .slice(1)
    .map((body) => ({ name: /name = "([^"]+)"/.exec(body)?.[1] ?? "", body }));
}

describe("D274 the updater no longer brings in zip", () => {
  it("z1 the updater drops its default features", () => {
    expect(updaterSpec()).toMatch(/default-features\s*=\s*false/);
  });

  it("z2 it keeps exactly the other defaults, so TLS and proxy are unchanged", () => {
    expect(updaterFeatures()).toEqual(["rustls-tls", "system-proxy"]);
  });

  it("z3 Cargo.lock has no zip package, on any target", () => {
    expect(lockPackages().filter((p) => p.name === "zip").length).toBe(0);
  });

  it("z4 the locked updater lists no zip dependency", () => {
    const updater = lockPackages().find((p) => p.name === "tauri-plugin-updater");
    expect(updater).toBeDefined();
    expect(/^ "zip( [^"]*)?",?$/m.test(updater?.body ?? "")).toBe(false);
  });
});
