// @vitest-environment node
/**
 * D162-WI-3 guard (ADR-0082): mdpro's table cell paste relies on
 * `patches/prosemirror-tables@1.8.5.patch`, which fixes `clipCells`' rowspan
 * clip and `insertCells`' closing selection. The patch is keyed to the exact
 * version, so it only helps when the prosemirror-tables Milkdown actually
 * resolves is 1.8.5. pnpm fails install on an unused patch, but not when some
 * other package keeps a patched 1.8.5 while Milkdown moves to a newer copy —
 * this test catches that.
 *
 * Remove it with the patch, once a prosemirror-tables release carrying both
 * fixes is what `@milkdown/prose` resolves.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const KEY = "prosemirror-tables@1.8.5";

/**
 * The directory of package `name` as Node resolves it from `fromDir` (real path,
 * so pnpm's symlinks lead into the store layout). Walks `require.resolve.paths`
 * rather than resolving `<name>/package.json`, which these packages' `exports`
 * do not expose.
 */
function packageDir(name: string, fromDir: string): string {
  const paths = createRequire(resolve(fromDir, "noop.js")).resolve.paths(name) ?? [];
  for (const base of paths) {
    const dir = resolve(base, name);
    if (existsSync(resolve(dir, "package.json"))) return realpathSync(dir);
  }
  throw new Error(`${name} not resolvable from ${fromDir}`);
}

/** The prosemirror-tables version resolved from @milkdown/prose's own location. */
function versionThroughMilkdown(): string {
  const kit = packageDir("@milkdown/kit", ROOT);
  const prose = packageDir("@milkdown/prose", kit);
  const tables = packageDir("prosemirror-tables", prose);
  const manifest = JSON.parse(readFileSync(resolve(tables, "package.json"), "utf8")) as { version: string };
  return manifest.version;
}

/** `patchedDependencies` from package.json's `pnpm` field and pnpm-workspace.yaml, merged. */
function patchedDependencies(): Record<string, string> {
  const out: Record<string, string> = {};
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    pnpm?: { patchedDependencies?: Record<string, string> };
  };
  Object.assign(out, pkg.pnpm?.patchedDependencies ?? {});
  const workspace = resolve(ROOT, "pnpm-workspace.yaml");
  if (existsSync(workspace)) {
    const lines = readFileSync(workspace, "utf8").split("\n");
    const at = lines.findIndex((l) => /^patchedDependencies:\s*$/.test(l));
    for (let i = at + 1; at >= 0 && i < lines.length && /^\s+\S/.test(lines[i]); i += 1) {
      const m = /^\s+['"]?([^'":]+@[^'":]+)['"]?:\s*['"]?([^'"]+?)['"]?\s*$/.exec(lines[i]);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

describe("D162-WI-3 — the prosemirror-tables patch is the one Milkdown runs", () => {
  it("Milkdown resolves prosemirror-tables 1.8.5, the version the patch is keyed to", () => {
    expect(versionThroughMilkdown()).toBe("1.8.5");
  });

  it(`pnpm records a patch for ${KEY}, and the patch file exists`, () => {
    const patches = patchedDependencies();
    expect(Object.keys(patches)).toContain(KEY);
    const file = resolve(ROOT, patches[KEY]);
    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, "utf8");
    expect(body).toContain("dist/index.js");
    expect(body).toContain("dist/index.cjs");
  });

  it("the copy Milkdown resolves carries both fixes, in both entry points", () => {
    const tables = packageDir("prosemirror-tables", packageDir("@milkdown/prose", packageDir("@milkdown/kit", ROOT)));
    for (const entry of ["dist/index.js", "dist/index.cjs"]) {
      const body = readFileSync(resolve(tables, entry), "utf8");
      expect(`${entry}: ${body.includes("rowspan: Math.max(1, newHeight - row)")}`).toBe(`${entry}: true`);
      expect(`${entry}: ${body.includes("map.positionAt(bottom - 1, right - 1, table)")}`).toBe(`${entry}: false`);
    }
  });

  it("the lockfile records the same patch", () => {
    const lock = readFileSync(resolve(ROOT, "pnpm-lock.yaml"), "utf8");
    expect(lock).toMatch(/^patchedDependencies:\s*$/m);
    expect(lock).toContain(KEY);
  });
});
