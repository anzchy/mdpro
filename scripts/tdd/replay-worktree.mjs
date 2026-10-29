/**
 * Purpose: The replay's worktree side (ADR-0149 d2): classify a commit's test paths,
 * build a tree of chosen paths, run tests in a detached worktree at the head whose
 * non-test paths are restored to the PR base, and put the head back for the second run.
 *
 * Key decisions:
 * - The worktree is `<root>/verify-<sha7>-replay-<id>`, root being MDPRO_REPLAY_ROOT, else
 *   the `mdpro-wt/` beside the main checkout when it exists, else the OS temp dir. An
 *   existing directory refuses; the worktree is always removed afterwards, and nothing else
 *   is pruned.
 * - Restore, per path changed base → head: a pure test path keeps the head; a Rust file
 *   holding test modules gets base production spliced with the head's test modules (an
 *   unspliceable one refuses); any other path is checked out at base, or removed if the
 *   branch added it. Item-level `#[cfg(test)]` seams are production and go back to base.
 * - Dependencies: an unchanged package.json and pnpm-lock.yaml reuse the caller's
 *   node_modules; otherwise `pnpm install --frozen-lockfile --offline` runs, and a
 *   failure refuses.
 * - Runs never use the worktree's own lane scripts or config: Vitest receipts run Vitest
 *   directly; Rust receipts run the lane command the sidecar recorded, with both output
 *   streams captured here. Each run goes through the caller's `scripts/heavy-lock.sh`
 *   when it has one, and is bounded by MDPRO_REPLAY_TIMEOUT_MS (default 900 s); a run that
 *   times out or is killed is reported as that, never parsed as partial output.
 * @coordinates-with scripts/tdd/receipt-replay.mjs, scripts/tdd/receipt-tree.mjs, scripts/tdd/rust-splice.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { usageError } from "./unit-red-lane.mjs";
import { classifyTestPaths, git } from "./receipt-tree.mjs";
import { libtestOutcomes, vitestOutcomes } from "./receipt-failures.mjs";
import { spliceTestMods } from "./rust-splice.mjs";

const DEFAULT_RUN_TIMEOUT_MS = 900_000;
const runTimeout = () => Number(process.env.MDPRO_REPLAY_TIMEOUT_MS || DEFAULT_RUN_TIMEOUT_MS);
/** Why a spawned run did not finish, or null when it did. */
const unfinished = (run) => (run.error?.code === "ETIMEDOUT" || (run.signal && !run.error) ? `timed out or killed (${run.signal || run.error.code})` : run.error ? `did not start (${run.error.message})` : null);

/** `{path: {mode, blob}}` of every file in `rev`. */
export function filesAt(cwd, rev) {
  const files = new Map();
  for (const line of git(cwd, ["ls-tree", "-r", "-z", "--full-tree", rev]).stdout.split("\0").filter(Boolean)) {
    const [meta, path] = line.split("\t"), [mode, type, blob] = meta.split(" ");
    if (type === "blob") files.set(path, { mode, blob });
  }
  return files;
}

function readBlobs(cwd, blobs) {
  const texts = new Map();
  if (!blobs.length) return texts;
  const out = spawnSync("git", ["cat-file", "--batch"], { cwd, input: `${blobs.join("\n")}\n`, maxBuffer: 512 * 1024 * 1024 }).stdout;
  let at = 0;
  for (const blob of blobs) {
    const eol = out.indexOf(10, at), size = Number(out.subarray(at, eol).toString().split(" ")[2]);
    texts.set(blob, out.subarray(eol + 1, eol + 1 + size).toString("utf8"));
    at = eol + 2 + size;
  }
  return texts;
}

/** Test-path classification of commit `rev`, plus its file table. */
export function classifyAt(cwd, rev) {
  const files = filesAt(cwd, rev);
  const candidates = new Set([...files.keys()].filter((path) => path.startsWith("tests/") || path.startsWith("src-tauri/")));
  const rust = [...candidates].filter((path) => path.endsWith(".rs")).map((path) => files.get(path).blob);
  const texts = readBlobs(cwd, [...new Set(rust)]);
  const result = classifyTestPaths(candidates, (path) => texts.get(files.get(path).blob) ?? "");
  return { files, tests: new Set(result.tests), holders: new Set(result.holders), unspliceable: new Set(result.unspliceable) };
}

/** A tree holding `paths` exactly as commit `files` has them. */
export function treeOf(cwd, files, paths) {
  const folder = mkdtempSync(join(tmpdir(), "mdpro-replay-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(folder, "index") };
  try {
    git(cwd, ["read-tree", "--empty"], { env });
    const rows = paths.filter((path) => files.has(path)).map((path) => `${files.get(path).mode} ${files.get(path).blob}\t${path}\0`);
    if (rows.length) git(cwd, ["update-index", "-z", "--index-info"], { env, input: rows.join("") });
    return git(cwd, ["write-tree"], { env }).stdout.trim();
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

export const isPureTest = (cls, path) => cls.tests.has(path) && !cls.holders.has(path);

function replayRoot(cwd) {
  if (process.env.MDPRO_REPLAY_ROOT) return process.env.MDPRO_REPLAY_ROOT;
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim();
  const beside = join(dirname(dirname(common)), "mdpro-wt");
  return existsSync(beside) ? beside : tmpdir();
}

/** Run `operation(dir)` in a detached worktree at `head`, always removed afterwards. */
export function withWorktree(cwd, head, id, operation) {
  const dir = join(replayRoot(cwd), `verify-${head.slice(0, 7)}-replay-${id}`);
  if (existsSync(dir)) throw usageError(`Replay worktree ${dir} already exists; remove it first.`);
  git(cwd, ["worktree", "add", "-q", "--detach", dir, head]);
  try { return operation(dir); }
  // Only this worktree is removed: a repo-wide `git worktree prune` would also drop another
  // session's prunable record, which `git worktree repair` could then no longer reattach.
  finally { git(cwd, ["worktree", "remove", "--force", dir], { allowFail: true }); }
}

/** Restore `dir` (checked out at head) to base for every non-test path; returns the paths it touched. */
export function restoreToBase(cwd, dir, base, head, baseCls, headCls) {
  const touched = [], checkout = [];
  const changes = git(cwd, ["diff-tree", "-r", "-z", "--no-renames", "--name-status", base, head]).stdout.split("\0").filter(Boolean);
  for (let index = 0; index < changes.length; index += 2) {
    const path = changes[index + 1];
    if (isPureTest(headCls, path) || (!headCls.files.has(path) && isPureTest(baseCls, path))) continue;
    touched.push(path);
    const inBase = baseCls.files.has(path), inHead = headCls.files.has(path);
    if (headCls.holders.has(path) || baseCls.holders.has(path)) {
      if (headCls.unspliceable.has(path) || baseCls.unspliceable.has(path)) throw usageError(`Cannot splice ${path}: its test modules could not be scanned; the replay refuses.`);
      if (inBase && inHead) {
        const read = (rev) => git(cwd, ["show", `${rev}:${path}`]).stdout;
        writeFileSync(join(dir, path), spliceTestMods(read(base), read(head)));
        continue;
      }
    }
    if (inBase) checkout.push(path);
    else rmSync(join(dir, path), { force: true });
  }
  if (checkout.length) git(dir, ["checkout", "--pathspec-from-file=-", "--pathspec-file-nul", base], { input: checkout.map((path) => `${path}\0`).join("") });
  return touched;
}

/** Put every touched path back as the head has it. */
export function restoreHead(dir, head, headCls, touched) {
  const back = touched.filter((path) => headCls.files.has(path));
  for (const path of touched.filter((item) => !headCls.files.has(item))) rmSync(join(dir, path), { force: true });
  if (back.length) git(dir, ["checkout", "--pathspec-from-file=-", "--pathspec-file-nul", head], { input: back.map((path) => `${path}\0`).join("") });
}

function heavy(cwd, argv) {
  const lock = join(cwd, "scripts/heavy-lock.sh");
  return existsSync(lock) ? [lock, ...argv] : argv;
}

export function linkDependencies(cwd, dir, base, head) {
  if (!git(cwd, ["diff-tree", "--name-only", base, head, "--", "package.json", "pnpm-lock.yaml"]).stdout.trim()) {
    if (!existsSync(join(dir, "node_modules")) && existsSync(join(cwd, "node_modules"))) symlinkSync(join(cwd, "node_modules"), join(dir, "node_modules"));
    return;
  }
  const [command, ...args] = heavy(cwd, ["pnpm", "install", "--frozen-lockfile", "--offline"]);
  if (spawnSync(command, args, { cwd: dir, encoding: "utf8", timeout: runTimeout() }).status !== 0) throw usageError("pnpm install for the base lockfile failed; the replay refuses.");
}

/** Run the receipt's tests in `dir`: `{outcomes, compileError, error}`. */
export function runTests(cwd, dir, { lane, files, laneCommand }) {
  // The entry's own lock, selection and evidence variables must not reach the replayed
  // tests: a test that spawns the entry would otherwise use this process's flock.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^MDPRO_(?:UNIT_RED_|RED_EVIDENCE_DIR$)/.test(key)));
  env.VITEST_MAX_WORKERS = "1";
  const root = realpathSync.native(dir);
  if (lane === "rust") {
    if (!laneCommand) return { outcomes: new Map(), compileError: false, error: "no lane command recorded" };
    const run = spawnSync("sh", ["-c", laneCommand], { cwd: dir, env, encoding: "utf8", timeout: runTimeout(), maxBuffer: 256 * 1024 * 1024 });
    if (unfinished(run)) return { outcomes: new Map(), compileError: false, error: `the run ${unfinished(run)}` };
    try { return { ...libtestOutcomes(run.stdout, run.stderr, root), error: null }; }
    catch (error) { return { outcomes: new Map(), compileError: false, error: error.message }; }
  }
  const out = mkdtempSync(join(tmpdir(), "mdpro-replay-run-"));
  try {
    const [command, ...args] = heavy(cwd, ["pnpm", "exec", "vitest", "run", "--coverage.enabled=false", "--maxWorkers=1", "--reporter=json", `--outputFile.json=${join(out, "vitest.json")}`, ...files]);
    const run = spawnSync(command, args, { cwd: dir, env, encoding: "utf8", timeout: runTimeout(), maxBuffer: 256 * 1024 * 1024 });
    if (unfinished(run)) return { outcomes: new Map(), compileError: false, error: `the run ${unfinished(run)}` };
    if (!existsSync(join(out, "vitest.json"))) return { outcomes: new Map(), compileError: false, error: "Vitest wrote no report" };
    return { outcomes: vitestOutcomes(JSON.parse(readFileSync(join(out, "vitest.json"), "utf8")), root), compileError: false, error: null };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

export function ensureDir(path) { mkdirSync(path, { recursive: true }); return path; }
