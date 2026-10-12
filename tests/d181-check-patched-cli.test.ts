// @vitest-environment node
/**
 * D181-WI-1: the patched-dependency guard as a command. An incremental
 * `pnpm install --frozen-lockfile --offline` once exited 0 and left
 * `node_modules/.pnpm/prosemirror-tables@1.8.5_patch_hash=…/` holding the
 * ORIGINAL dist files (D181), and a build would have shipped them. These
 * tests run the real script against a temp tree laid out like node_modules,
 * and against this checkout, and pin that install and build both go through
 * it.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SCRIPT = resolve(ROOT, "scripts/deps/check-patched.mjs");
const PATCH_REL = "patches/prosemirror-tables@1.8.5.patch";
const HASHED = "prosemirror-tables@1.8.5_patch_hash=6fc7e27ff7eaef78bca7be9d9cd4059c256d2d9319797902e71e5c909627ec87";

/** The two lines the patch adds, and the original lines it replaces (from the patch itself). */
const FIXES: Array<[patched: string, original: string]> = [
  [
    "rowspan: Math.max(1, newHeight - row)",
    "rowspan: Math.max(1, newHeight - cell.attrs.rowspan)",
  ],
  [
    "map.map[top * map.width + left]), tr.doc.resolve(tableStart + map.map[(bottom - 1) * map.width + right - 1])",
    "map.positionAt(top, left, table)), tr.doc.resolve(tableStart + map.positionAt(bottom - 1, right - 1, table))",
  ],
];

const INSTALLED = realpathSync(resolve(ROOT, "node_modules/.pnpm/node_modules/prosemirror-tables"));

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop() as string, { recursive: true, force: true });
});

type Copy = {
  dir: string;
  patched: boolean;
  /** How the copy is reached: an importer dir in `.pnpm` links to it (default), the root `node_modules` links to it, or nothing does. */
  link?: "importer" | "root" | "none";
  version?: string;
};

/** A symlink at `from` pointing at `to`, relative like pnpm's. */
function link(from: string, to: string): void {
  mkdirSync(dirname(from), { recursive: true });
  symlinkSync(relative(dirname(from), to), from);
}

/**
 * A temp project: package.json with the real patchedDependencies, the real
 * patch, and one installed copy per entry, linked the way pnpm links a used
 * copy (from `.pnpm/<importer>/node_modules/prosemirror-tables`) unless
 * `link: "none"` — a leftover directory nothing resolves to.
 */
function fixture(copies: Copy[], opts: { patch?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "d181-"));
  temps.push(root);
  const pkg = { name: "fx", private: true, pnpm: { patchedDependencies: { "prosemirror-tables@1.8.5": PATCH_REL } } };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  if (opts.patch !== false) {
    mkdirSync(join(root, "patches"));
    cpSync(resolve(ROOT, PATCH_REL), join(root, PATCH_REL));
  }
  copies.forEach((copy, index) => {
    const target = join(root, "node_modules/.pnpm", copy.dir, "node_modules/prosemirror-tables");
    mkdirSync(join(target, "dist"), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(INSTALLED, "package.json"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(target, "package.json"), JSON.stringify({ ...manifest, version: copy.version ?? "1.8.5" }));
    const via = copy.link ?? "importer";
    if (via === "importer") link(join(root, `node_modules/.pnpm/importer-${index}@1.0.0/node_modules/prosemirror-tables`), target);
    if (via === "root") link(join(root, "node_modules/prosemirror-tables"), target);
    for (const entry of ["dist/index.js", "dist/index.cjs"]) {
      let body = readFileSync(join(INSTALLED, entry), "utf8");
      if (!copy.patched) {
        for (const [patched, original] of FIXES) {
          expect(body.includes(patched)).toBe(true);
          body = body.replace(patched, original);
        }
      }
      writeFileSync(join(target, entry), body);
    }
  });
  return root;
}

function run(root: string) {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, stderr: r.stderr };
}

describe("D181-WI-1 check-patched — against a temp node_modules", () => {
  it("an unpatched copy in the _patch_hash directory (the D181 state) fails, naming package, files and the fix", () => {
    const r = run(fixture([{ dir: HASHED, patched: false }]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("prosemirror-tables@1.8.5");
    expect(r.stderr).toContain(PATCH_REL);
    expect(r.stderr).toContain("dist/index.js");
    expect(r.stderr).toContain("dist/index.cjs");
    expect(r.stderr).toContain("rowspan: Math.max(1, newHeight - row)");
    expect(r.stderr).toContain("pnpm install --force");
  });

  it("a correctly patched copy passes", () => {
    const r = run(fixture([{ dir: HASHED, patched: true }]));
    expect(r.out).toContain("prosemirror-tables@1.8.5");
    expect(r.status).toBe(0);
  });

  // Replaced (coordinator, 2026-10-12): this case once required EVERY copy in
  // `.pnpm` to be patched. That was the wrong spec — `pnpm install --force`
  // leaves the unlinked `prosemirror-tables@1.8.5/` leftover in place, so the
  // guard's own fix could never clear it (seen in the D166 and D162d
  // worktrees). Only copies something links to are used, so only they count.
  it("an unpatched leftover nothing links to is ignored when the linked copy is patched (note only)", () => {
    const r = run(fixture([
      { dir: HASHED, patched: true },
      { dir: "prosemirror-tables@1.8.5", patched: false, link: "none" },
    ]));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("node_modules/.pnpm/prosemirror-tables@1.8.5/node_modules/prosemirror-tables");
    expect(r.stderr).toMatch(/not linked/);
  });

  it("an importer linking to a plain, unpatched directory fails", () => {
    const r = run(fixture([
      { dir: HASHED, patched: true },
      { dir: "prosemirror-tables@1.8.5", patched: false },
    ]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("node_modules/.pnpm/prosemirror-tables@1.8.5/node_modules/prosemirror-tables/dist/index.js");
    expect(r.stderr).not.toContain(`${HASHED}/node_modules/prosemirror-tables/dist`);
  });

  it("a root node_modules link to an unpatched copy fails", () => {
    const r = run(fixture([{ dir: "prosemirror-tables@1.8.5", patched: false, link: "root" }]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("pnpm install --force");
  });

  it("copies that exist but are not linked from anywhere count as not installed", () => {
    const r = run(fixture([{ dir: HASHED, patched: true, link: "none" }]));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not installed/);
  });

  it("a copy of another version is not this patch's business", () => {
    const r = run(fixture([
      { dir: HASHED, patched: true },
      { dir: "prosemirror-tables@1.8.4", patched: false, version: "1.8.4" },
    ]));
    expect(r.status).toBe(0);
  });

  it("no installed copy at all fails: a patch that targets nothing protects nothing", () => {
    const r = run(fixture([]));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("prosemirror-tables@1.8.5");
    expect(r.stderr).toMatch(/not installed/);
  });

  it("a patch file that is missing is a configuration error (exit 2)", () => {
    const r = run(fixture([{ dir: HASHED, patched: true }], { patch: false }));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(PATCH_REL);
  });

  it("a project with no patchedDependencies passes with nothing to check", () => {
    const root = mkdtempSync(join(tmpdir(), "d181-"));
    temps.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fx" }));
    expect(run(root).status).toBe(0);
  });
});

describe("D181-WI-1 check-patched — this checkout", () => {
  it("the installed node_modules carries every patch (exit 0)", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(`${r.status} ${r.stdout}${r.stderr}`).toMatch(/^0 [\s\S]*prosemirror-tables@1\.8\.5/);
  });
});

describe("D181-WI-1 wiring — install and build both run the guard", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

  it("postinstall runs the guard", () => {
    expect(pkg.scripts.postinstall).toMatch(/^node scripts\/deps\/check-patched\.mjs(\s|$)/);
  });

  it("build runs the guard before tsc and vite", () => {
    expect(pkg.scripts.build).toMatch(/^node scripts\/deps\/check-patched\.mjs && tsc && vite build$/);
  });

  it("tauri build goes through `pnpm build`, so it inherits the guard", () => {
    const conf = JSON.parse(readFileSync(resolve(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as {
      build: { beforeBuildCommand: string };
    };
    expect(conf.build.beforeBuildCommand).toBe("pnpm build");
  });
});
