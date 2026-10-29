/**
 * Purpose: The RED-time test tree (ADR-0149 d1): which paths are test paths, the tree of
 * their working-tree bytes, and the create-only ref that pins it locally.
 *
 * Test paths (ADR-0145 d2's definition): every path under `tests/` and `src-tauri/tests/`;
 * every `.rs` file under `src-tauri/` holding a top-level `#[cfg(test)] mod`; and every
 * file such a declaration reaches (`#[path]`, else the default module path), transitively
 * through that file's own `mod x;` declarations.
 *
 * Key decisions:
 * - Paths are what git would see: tracked and untracked-but-not-ignored, minus tracked
 *   files deleted in the working tree. The bytes are the working tree's, dirty edits
 *   included, hashed with `git hash-object -w` (clean filters applied, as `git add`).
 * - The tree is written through a private GIT_INDEX_FILE, so the real index and working
 *   tree are never touched. Modes are kept: 100755, and 120000 for a symlink's text.
 * - The ref is `refs/receipts/<id>/<recorded-at without - : .>/tests`, created only when
 *   no ref of that name exists. It lives in the common git dir, so every worktree sees
 *   it; nothing here pushes it.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-replay.mjs, scripts/tdd/rust-splice.mjs
 */
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { spawnSync } from "node:child_process";
import { usageError } from "./unit-red-lane.mjs";
import { modItems } from "./rust-splice.mjs";

const ZERO = "0".repeat(40);

export function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0 && !options.allowFail) throw usageError(`git ${args[0]} failed: ${(result.stderr || "").trim().split("\n")[0]}`);
  return result;
}

export function isPlainTestPath(path) {
  return path.startsWith("tests/") || path.startsWith("src-tauri/tests/");
}

/** Where `mod name;` declared in `file` lives, or null when neither candidate exists in `exists`. */
function moduleFile(file, item, exists) {
  const dir = posix.dirname(file);
  if (item.path) return posix.normalize(posix.join(dir, item.path));
  const base = posix.basename(file);
  const owner = ["mod.rs", "lib.rs", "main.rs"].includes(base) ? dir : posix.join(dir, base.replace(/\.rs$/, ""));
  return [posix.join(owner, `${item.name}.rs`), posix.join(owner, item.name, "mod.rs")].find(exists) ?? null;
}

/**
 * The test paths among `candidates` (repo-relative), reading Rust text through `readText`.
 * Shared by the working-tree pin and by the replay, which classifies a commit's paths.
 */
export function classifyTestPaths(candidates, readText) {
  const exists = (path) => candidates.has(path);
  const tests = new Set([...candidates].filter(isPlainTestPath));
  const queue = [];
  for (const file of candidates) {
    if (!file.startsWith("src-tauri/") || !file.endsWith(".rs") || tests.has(file)) continue;
    const items = modItems(readText(file));
    if (!items.some((item) => item.test)) continue;
    tests.add(file);
    for (const item of items) if (item.test && !item.inline) queue.push(moduleFile(file, item, exists));
  }
  while (queue.length) {
    const file = queue.pop();
    if (!file || tests.has(file) || !exists(file)) continue;
    tests.add(file);
    for (const item of modItems(readText(file))) if (!item.inline) queue.push(moduleFile(file, item, exists));
  }
  return [...tests].sort();
}

/** The test paths of the working tree. */
export function testPaths(cwd) {
  const listed = git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "tests", "src-tauri"]).stdout.split("\0").filter(Boolean);
  const deleted = new Set(git(cwd, ["ls-files", "-z", "--deleted", "--", "tests", "src-tauri"]).stdout.split("\0").filter(Boolean));
  const candidates = new Set(listed.filter((path) => !deleted.has(path) && existsSync(join(cwd, path))));
  return classifyTestPaths(candidates, (path) => readFileSync(join(cwd, path), "utf8"));
}

/** Write the working-tree bytes of `paths` as one tree; returns its id. */
export function buildTree(cwd, paths) {
  const rows = [];
  const regular = paths.filter((path) => !lstatSync(join(cwd, path)).isSymbolicLink());
  const blobs = regular.length ? git(cwd, ["hash-object", "-w", "--stdin-paths"], { input: `${regular.join("\n")}\n` }).stdout.trim().split("\n") : [];
  regular.forEach((path, index) => rows.push(`${lstatSync(join(cwd, path)).mode & 0o111 ? "100755" : "100644"} ${blobs[index]}\t${path}`));
  for (const path of paths.filter((item) => !regular.includes(item))) {
    const blob = git(cwd, ["hash-object", "-w", "--stdin"], { input: readlinkSync(join(cwd, path)) }).stdout.trim();
    rows.push(`120000 ${blob}\t${path}`);
  }
  const folder = mkdtempSync(join(tmpdir(), "mdpro-receipt-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(folder, "index") };
  try {
    git(cwd, ["read-tree", "--empty"], { env });
    if (rows.length) git(cwd, ["update-index", "-z", "--index-info"], { env, input: rows.map((row) => `${row}\0`).join("") });
    return git(cwd, ["write-tree"], { env }).stdout.trim();
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

/** The pin ref name for a receipt; refuses a name git would reject. */
export function refFor(cwd, id, recordedAt) {
  const ref = `refs/receipts/${id}/${String(recordedAt).replace(/[-:.]/g, "")}/tests`;
  if (git(cwd, ["check-ref-format", ref], { allowFail: true }).status !== 0) throw usageError(`Receipt id ${id} cannot name a git ref.`);
  return ref;
}

/** Create `ref` → `tree`, only if no ref of that name exists. */
export function pinRef(cwd, ref, tree) {
  if (git(cwd, ["update-ref", ref, tree, ZERO], { allowFail: true }).status !== 0) throw usageError(`Pin ref ${ref} already exists or cannot be created.`);
}

/** The object a ref points at, or null. */
export function resolveRef(cwd, ref) {
  const result = git(cwd, ["rev-parse", "--verify", "--quiet", ref], { allowFail: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

export const repoParent = (cwd) => dirname(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim());
