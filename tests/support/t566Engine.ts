/**
 * Purpose: Shared pieces of the #566 tests: the vendored receipt engine's location and
 * upstream hashes, the README manifest check, and a `HOME` whose plugin caches are poisoned.
 * @coordinates-with tests/tooling/t566-no-cache.test.ts, tests/tooling/t566-vendor-manifest.test.ts, tests/tooling/t566-fail-closed.test.ts
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../..");
export const ENGINE_VERSION = "0.10.2";
export const vendorDir = join(repoRoot, `scripts/tdd/vendor/tdd-guardian-${ENGINE_VERSION}`);

/** SHA-256 of each file in the vendored closure: upstream 0.10.2 bytes, plus mdpro's CommonJS scope shim. */
export const PINNED: Record<string, string> = {
  "receipt.js": "ae42fb32b4e891c00fb0599401440931038d7aa76b05e6cc82a755fccd01f82d",
  "lib/config.js": "eab9862b8e2b372819ce19073dd9ee2009b232c16f835bc56adae337651cb9c5",
  "lib/coverage.js": "855ea57f4ee2be80242754b89b2fcaf62ae7847f50d9ae32112bc211d2d449a0",
  "lib/exec.js": "1ad0c9ecc746f5ff44ae315d647763d1f36a394bad00a74493e55b55b4f2b31a",
  "lib/lanes.js": "2d90bb0269799b78332b805c46f73cad51eb76ae1960f0ddef880a27b82e8892",
  "lib/verification.js": "7f6231c2067ec0c0e535118fd37b7667695e82ed558b62c9beed3e01cc95a951",
  LICENSE: "87b3f4064cb76d1c7cc8c39546d7d62790b76372f37cfb9de1bb828a5f652b51",
  "package.json": "8005a3491db7d92f36ac66369861589f9c47123d3a7c71e643fc2c06168cd45a",
};

export const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    return item.isDirectory() ? walk(path, root) : [relative(root, path)];
  });
}

/** The README's `| \`file\` | \`sha256\` |` rows, in order. */
export function manifestRows(dir: string): Array<[string, string]> {
  const readme = join(dir, "README.md");
  if (!existsSync(readme)) return [];
  return [...readFileSync(readme, "utf8").matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$/gm)].map((match) => [match[1], match[2]]);
}

/** Problems with a vendored directory against its README manifest; empty when it is intact. Never throws. */
export function checkVendor(dir: string): string[] {
  if (!existsSync(join(dir, "README.md"))) return [`missing: README.md`];
  const rows = manifestRows(dir);
  const problems: string[] = [];
  if (!rows.length) problems.push("manifest: no hash rows");
  const listed = new Map<string, string>();
  for (const [file, hash] of rows) {
    if (listed.has(file)) problems.push(`duplicate: ${file}`);
    listed.set(file, hash);
  }
  for (const [file, hash] of listed) {
    if (!existsSync(join(dir, file))) problems.push(`missing: ${file}`);
    else if (sha256(join(dir, file)) !== hash) problems.push(`sha256 mismatch: ${file}`);
  }
  for (const file of walk(dir).sort()) if (file !== "README.md" && !listed.has(file)) problems.push(`unlisted: ${file}`);
  return problems;
}

const poisonEngine = (marker: string) => ({
  "receipt.js": `require("fs").appendFileSync(${JSON.stringify(marker)}, "receipt.js\\n"); process.exit(0);\n`,
  ...Object.fromEntries(["config", "coverage", "exec", "lanes", "verification"].map((name) => [
    `lib/${name}.js`,
    `require("fs").appendFileSync(${JSON.stringify(marker)}, "lib/${name}.js\\n"); throw new Error("poisoned cache");\n`,
  ])),
});

/** A fresh HOME. With `poison`, Claude's and Codex's tdd-guardian caches hold, at 9.9.9 and 0.10.2, an engine that writes `marker` when run. */
export function makeHome(poison: boolean) {
  const home = mkdtempSync(join(tmpdir(), "mdpro-t566-home-"));
  const marker = join(home, "poison-ran");
  if (poison) {
    for (const tool of [".claude", ".codex"]) for (const version of ["9.9.9", ENGINE_VERSION]) {
      const base = join(home, tool, "plugins/cache/xiaolai/tdd-guardian", version, "scripts/tdd-guardian");
      for (const [file, text] of Object.entries(poisonEngine(marker))) {
        mkdirSync(dirname(join(base, file)), { recursive: true });
        writeFileSync(join(base, file), text);
      }
      writeFileSync(join(home, tool, "plugins/cache/xiaolai/tdd-guardian", version, "package.json"), '{"type":"commonjs"}\n');
    }
  }
  return { home, marker };
}

/** Make both plugin roots unreadable, so any probe into them throws. */
export function lockPluginRoots(home: string) {
  for (const tool of [".claude", ".codex"]) {
    mkdirSync(join(home, tool, "plugins"), { recursive: true });
    chmodSync(join(home, tool, "plugins"), 0o000);
  }
}
export function unlockPluginRoots(home: string) {
  for (const tool of [".claude", ".codex"]) if (existsSync(join(home, tool))) chmodSync(join(home, tool, "plugins"), 0o755);
}

const toolchains = join(homedir(), ".rustup/toolchains");
/** The real rustfmt, found before HOME is replaced; null when none is installed. */
export const rustfmt = [
  ...(process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "rustfmt")),
  join(homedir(), ".cargo/bin/rustfmt"),
  ...(existsSync(toolchains) ? readdirSync(toolchains).map((name) => join(toolchains, name, "bin/rustfmt")) : []),
].find((path) => existsSync(path)) ?? null;

/** Child env for a replaced HOME: corepack keeps its real cache (no download), and rustfmt stays on PATH. */
export function homeEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    COREPACK_HOME: process.env.COREPACK_HOME ?? join(homedir(), ".cache/node/corepack"),
    PATH: [rustfmt ? dirname(rustfmt) : null, process.env.PATH].filter(Boolean).join(delimiter),
  };
}
