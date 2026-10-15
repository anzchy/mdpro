// @vitest-environment node
/**
 * ADR-0098 phase 1: the test applier's fixture cases. Runs in the unit lane. Each case builds a
 * throwaway git repo, runs scripts/redesign/adr0098-apply.mjs on it, and pins the exact bytes it
 * writes.
 *
 * Mocked: nothing. Real git, real node, the repo's own typescript (through a node_modules
 * symlink in each temp repo).
 */
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const APPLY = path.join(ROOT, "scripts/redesign/adr0098-apply.mjs");

interface Move {
  from: string;
  to: string;
  class: "control" | "tooling" | "perf";
}
interface Manifest {
  baseline: string;
  moves: Move[];
}
interface FixtureRepo {
  dir: string;
  baseline: string;
}

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string>): FixtureRepo {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "adr0098-"));
  made.push(parent);
  const dir = path.join(parent, "repo");
  fs.mkdirSync(dir);
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "package.json"), "{}\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
  return { dir, baseline: git("rev-parse", "HEAD").trim() };
}

function run(mode: string, dir: string, manifest: Manifest, ...flags: string[]): SpawnSyncReturns<string> {
  const file = path.join(path.dirname(dir), "manifest.json");
  fs.writeFileSync(file, JSON.stringify(manifest));
  return spawnSync(process.execPath, [APPLY, mode, dir, file, ...flags], { encoding: "utf8" });
}

const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), "utf8");

const CONTROL = `import { a } from "../scripts/control/a.mjs";
import { h } from "./support/h";
import path from "node:path";
import { fileURLToPath } from "node:url";
vi.mock("../src/m", () => ({}));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SH = path.resolve(HERE, "../scripts/x.sh");
const SEG = path.resolve(__dirname, "..", "scripts", "x.sh");
const REPO = path.resolve(__dirname, "..");
const FIX = path.join(REPO, "tests/fixtures/f.json");
const URLED = new URL("../scripts/control", import.meta.url);
// see ../scripts/control/a.mjs in a comment
const SOURCE = 'import y from "../../docs/a.md"';
const TPL = \`new URL("../x", import.meta.url)\`;
`;
const CONTROL_AFTER = `import { a } from "../../scripts/control/a.mjs";
import { h } from "../support/h";
import path from "node:path";
import { fileURLToPath } from "node:url";
vi.mock("../../src/m", () => ({}));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SH = path.resolve(HERE, "../../scripts/x.sh");
const SEG = path.resolve(__dirname, "..", "..", "scripts", "x.sh");
const REPO = path.resolve(__dirname, "../..");
const FIX = path.join(REPO, "tests/fixtures/f.json");
const URLED = new URL("../../scripts/control", import.meta.url);
// see ../scripts/control/a.mjs in a comment
const SOURCE = 'import y from "../../docs/a.md"';
const TPL = \`new URL("../x", import.meta.url)\`;
`;

const BASE_FILES: Record<string, string> = {
  "tests/control-a.test.ts": CONTROL,
  "tests/support/h.ts": "export const h = 1;\n",
  "tests/fixtures/f.json": "{}\n",
  "scripts/control/a.mjs": "export const a = 1;\n",
  "scripts/x.sh": "#!/bin/sh\n",
  "src/m.ts": "export {};\n",
  "perf/p.perf.ts": 'import { h } from "./h";\n',
  "perf/h.ts": 'import { m } from "../src/m";\nexport const h = m;\n',
};
const MOVES: Move[] = [
  { from: "tests/control-a.test.ts", to: "tests/control/control-a.test.ts", class: "control" },
  { from: "perf/h.ts", to: "tests/perf/h.ts", class: "perf" },
  { from: "perf/p.perf.ts", to: "tests/perf/p.perf.ts", class: "perf" },
];

describe("ADR-0098 applier: apply and check", () => {
  it("rewrites imports, mocks, HERE, segmented, repo-root and URL anchors; keeps fixture text and comments", () => {
    const { dir, baseline } = repo(BASE_FILES);
    const manifest = { baseline, moves: MOVES };
    const r = run("apply", dir, manifest);
    expect(r.status, r.stderr).toBe(0);
    expect(read(dir, "tests/control/control-a.test.ts")).toBe(CONTROL_AFTER);
    const c = run("check", dir, manifest);
    expect(c.status, c.stdout + c.stderr).toBe(0);
  });

  it("a moving perf sibling stays a sibling; its ../src import gains a level", () => {
    const { dir, baseline } = repo(BASE_FILES);
    expect(run("apply", dir, { baseline, moves: MOVES }).status).toBe(0);
    expect(read(dir, "tests/perf/p.perf.ts")).toBe('import { h } from "./h";\n');
    expect(read(dir, "tests/perf/h.ts")).toBe('import { m } from "../../src/m";\nexport const h = m;\n');
  });

  it("an unmoved helper is not moved and not edited", () => {
    const { dir, baseline } = repo(BASE_FILES);
    expect(run("apply", dir, { baseline, moves: MOVES }).status).toBe(0);
    expect(read(dir, "tests/support/h.ts")).toBe(BASE_FILES["tests/support/h.ts"]);
  });

  it("check fails when a byte outside the reference literals changed", () => {
    const { dir, baseline } = repo(BASE_FILES);
    const manifest = { baseline, moves: MOVES };
    expect(run("apply", dir, manifest).status).toBe(0);
    const f = path.join(dir, "tests/control/control-a.test.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("../../docs/a.md", "../../../docs/a.md"));
    const c = run("check", dir, manifest);
    expect(c.status).not.toBe(0);
    expect(c.stdout).toMatch(/bytes changed outside the reference literals/);
  });

  it("check fails when a reference reaches a different target, with or without --refs-only", () => {
    const { dir, baseline } = repo(BASE_FILES);
    const manifest = { baseline, moves: MOVES };
    expect(run("apply", dir, manifest).status).toBe(0);
    const f = path.join(dir, "tests/control/control-a.test.ts");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"../support/h"', '"./support/h"'));
    expect(run("check", dir, manifest).status).not.toBe(0);
    expect(run("check", dir, manifest, "--refs-only").status).not.toBe(0);
  });

  it("apply refuses a destination collision before moving anything", () => {
    const { dir, baseline } = repo({ ...BASE_FILES, "tests/control/control-a.test.ts": "taken\n" });
    const r = run("apply", dir, { baseline, moves: MOVES });
    expect(r.status).toBe(3);
    expect(fs.existsSync(path.join(dir, "tests/control-a.test.ts")), "nothing moved").toBe(true);
    expect(fs.existsSync(path.join(dir, "perf/h.ts")), "nothing moved").toBe(true);
  });

  it("apply refuses two moves to one destination", () => {
    const { dir, baseline } = repo(BASE_FILES);
    const moves: Move[] = [...MOVES, { from: "perf/h.ts", to: "tests/perf/p.perf.ts", class: "perf" }];
    expect(run("apply", dir, { baseline, moves }).status).toBe(3);
  });
});

describe("ADR-0098 applier: the order of check and prose (rev5 N1)", () => {
  it("prose rewrites an old path in a moved file's comment; the byte check refuses it and --refs-only accepts it", () => {
    const files = { ...BASE_FILES, "tests/control-a.test.ts": `// its sibling is perf/p.perf.ts\n${CONTROL}` };
    const { dir, baseline } = repo(files);
    const manifest = { baseline, moves: MOVES };
    expect(run("apply", dir, manifest).status).toBe(0);
    expect(run("check", dir, manifest).status, "the byte proof holds right after apply").toBe(0);
    const p = run("prose", dir, manifest);
    expect(p.status, p.stdout + p.stderr).toBe(0);
    expect(read(dir, "tests/control/control-a.test.ts")).toBe(`// its sibling is tests/perf/p.perf.ts\n${CONTROL_AFTER}`);
    const full = run("check", dir, manifest);
    expect(full.status).not.toBe(0);
    expect(full.stdout).toMatch(/bytes changed outside the reference literals/);
    const refs = run("check", dir, manifest, "--refs-only");
    expect(refs.status, refs.stdout + refs.stderr).toBe(0);
  });
});

describe("ADR-0098 applier: the rebuild comparison reads a staged tree (rev6 P5.1)", () => {
  const git = (dir: string, ...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString().trim();

  function rebuild(): { dir: string; manifest: Manifest; tree: SpawnSyncReturns<string> } {
    const { dir, baseline } = repo(BASE_FILES);
    const manifest = { baseline, moves: MOVES };
    expect(run("apply", dir, manifest).status).toBe(0);
    expect(run("prose", dir, manifest).status).toBe(0);
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "docs/map.json"), JSON.stringify(manifest.moves));
    return { dir, manifest, tree: run("tree", dir, manifest, "--expect", "docs/map.json") };
  }

  it("two rebuilds from the same base reach one tree, the committed one, which a bare write-tree misses", () => {
    const a = rebuild();
    const b = rebuild();
    expect(a.tree.status, a.tree.stderr).toBe(0);
    expect(b.tree.status, b.tree.stderr).toBe(0);
    expect(a.tree.stdout).toBe(b.tree.stdout);

    git(a.dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "migration");
    expect(git(a.dir, "rev-parse", "HEAD^{tree}")).toBe(a.tree.stdout.trim());

    const { dir, baseline } = repo(BASE_FILES);
    expect(run("apply", dir, { baseline, moves: MOVES }).status).toBe(0);
    const stale = git(dir, "write-tree");
    const staged = run("tree", dir, { baseline, moves: MOVES });
    expect(staged.status, staged.stderr).toBe(0);
    expect(stale, "apply's rewrites are not in the index until tree stages them").not.toBe(staged.stdout.trim());
  });

  it("refuses when an expected file is ignored, so it would be missing from the tree", () => {
    const { dir, baseline } = repo({ ...BASE_FILES, ".gitignore": "node_modules\n*.map.json\n" });
    const manifest = { baseline, moves: MOVES };
    expect(run("apply", dir, manifest).status).toBe(0);
    fs.writeFileSync(path.join(dir, "move.map.json"), "[]\n");
    const r = run("tree", dir, manifest, "--expect", "move.map.json");
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stderr)).toMatchObject({ missing: ["move.map.json"] });
  });
});

describe("ADR-0098 applier: tree reads raw names and refuses a bad call (rev7 N6.1, N6.2)", () => {
  const QUOTED = 'tests/q"a.test.ts';
  const QUOTED_TO = 'tests/control/q"a.test.ts';
  const quotedMoves: Move[] = [...MOVES, { from: QUOTED, to: QUOTED_TO, class: "control" }];
  const indexTree = (dir: string) => execFileSync("git", ["write-tree"], { cwd: dir }).toString().trim();

  it("a destination whose name Git would quote is found in the index", () => {
    const { dir, baseline } = repo({ ...BASE_FILES, [QUOTED]: "export {};\n" });
    const manifest = { baseline, moves: quotedMoves };
    expect(run("apply", dir, manifest).status).toBe(0);
    const r = run("tree", dir, manifest);
    expect(r.status, r.stderr).toBe(0);
  });

  it("a source whose name Git would quote, still in the tree, is refused", () => {
    const { dir, baseline } = repo({ ...BASE_FILES, [QUOTED]: "export {};\n" });
    const manifest = { baseline, moves: quotedMoves };
    expect(run("apply", dir, manifest).status).toBe(0);
    fs.writeFileSync(path.join(dir, QUOTED), "export {};\n");
    const r = run("tree", dir, manifest);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stderr)).toMatchObject({ leftover: [QUOTED] });
  });

  it("a dangling --expect or an unknown flag exits 2 before anything is staged", () => {
    const { dir, baseline } = repo(BASE_FILES);
    const manifest = { baseline, moves: MOVES };
    expect(run("apply", dir, manifest).status).toBe(0);
    const before = indexTree(dir);
    for (const flags of [["--expect"], ["--expect", "--expect", "x"], ["--refs-only"], ["stray"]]) {
      const r = run("tree", dir, manifest, ...flags);
      expect(r.status, flags.join(" ")).toBe(2);
      expect(r.stdout, flags.join(" ")).toBe("");
      expect(indexTree(dir), `${flags.join(" ")} staged nothing`).toBe(before);
    }
  });
});
