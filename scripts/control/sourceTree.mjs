/**
 * Purpose: Compute `sourceTree` — the git tree id of a worktree's current,
 * non-excluded content — without touching the real index or object store.
 * It is the content half of the `buildId` (`buildId.mjs`). Also reads the
 * `HEAD` commit for the build manifest (`headCommit`).
 *
 * Pipeline (ADR-0047 plan, decisions O5, O6, O13):
 *   resolve toplevel + objects dir (works from a linked worktree)
 *   → temp dir: EMPTY index + private object dir, real objects as alternate
 *   → `git add -A` with exclude pathspecs (every non-ignored file, from content)
 *   → tracked-but-ignored files, listed read-only from the REAL index, still
 *     present and not excluded → `git add -f`
 *   → `git rm --cached` any excluded path that slipped in
 *   → `ls-files -s -z` of the finished temp index: any mode-160000 entry rejects
 *   → `git write-tree`
 *   → temp dir removed (success or failure)
 *
 * Key decisions:
 * - The temp index starts empty, never as a copy of the real one, so index
 *   flags (`assume-unchanged`, `skip-worktree`) and stat-cache data cannot
 *   freeze content: the tree depends on content, mode and path only.
 * - The child env drops exactly the variables `git rev-parse --local-env-vars`
 *   prints (GIT_DIR, GIT_INDEX_FILE, GIT_CONFIG_PARAMETERS, …) before setting
 *   its own. `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` pass through, so the
 *   user's config (e.g. a global `core.excludesFile`) applies: the tree is the
 *   view `git status` shows. `sourceTree` is therefore a same-machine identity
 *   for a worktree, not a cross-machine reproducible hash.
 * - Excludes are root-anchored: `dir/` means everything under `<root>/dir`,
 *   anything else is a git glob pathspec (`**` crosses directories, `*` does
 *   not). Keeping excluded roots out of `git add -A` means an untracked nested
 *   repository under one (e.g. `.claude/worktrees/agent-*`) is never visited.
 * - Gitlinks (mode 160000: a nested repo, tracked or untracked, `.git` dir or
 *   gitfile) are refused, because a gitlink records only the nested repo's
 *   HEAD commit: its uncommitted content would not move the tree, and one
 *   `buildId` would name two source states. The check reads the finished temp
 *   index, so it catches a gitlink whichever step added it. Symlinks (120000)
 *   are content and stay accepted.
 * - The real index and objects are only read; new blobs go to the temp object
 *   dir. Async; every git failure, and every filesystem failure once the temp
 *   dir exists, rejects with a `SourceTreeError` naming the repo dir. Two
 *   rejections do not name it: an invalid exclude (rejected before any git
 *   process, naming the exclude) and a failure to create the temp dir itself
 *   (the raw `mkdtemp` error).
 * - `headCommit` (the manifest's `commit`) shares the same scrubbed git env and
 *   is read-only; a repo with no commits gives `null`, not an error.
 * - Excludes are validated with `isValidExclude` from `buildId.mjs` (shared,
 *   not copied: non-empty, no leading `/`, no NUL, no `..` segment), before any
 *   git process or temp dir, so an exclude `computeBuildId` would refuse never
 *   produces a tree (WI-19).
 *
 * @module scripts/control/sourceTree
 * @coordinates-with scripts/control/buildId.mjs (isValidExclude)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidExclude } from "./buildId.mjs";

/** Decision 1: paths that are not build inputs. */
export const DEFAULT_EXCLUDES = Object.freeze([".claude/", "docs/", "**/*.tsbuildinfo"]);

const TMP_PREFIX = "mdpro-sourcetree-";

/** Thrown when the source tree cannot be computed; the message names the repo. */
export class SourceTreeError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "SourceTreeError";
  }
}

/**
 * @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, input?: Buffer }} opts
 * @returns {Promise<Buffer>} stdout
 */
function git(args, { cwd, env, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    /** @type {Buffer[]} */ const out = [];
    /** @type {Buffer[]} */ const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else {
        const stderr = Buffer.concat(err).toString("utf8").trim();
        const sub = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-c") ?? "";
        reject(new Error(`git ${sub} exited ${code}: ${stderr}`));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? Buffer.alloc(0));
  });
}

/** @type {Promise<string[]> | undefined} */
let localEnvVars;

/** The repo-local variables git itself names (O5); asked once per process. */
function getLocalEnvVars() {
  if (!localEnvVars) {
    /** @type {NodeJS.ProcessEnv} */
    const bootstrap = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith("GIT_") || k === "GIT_EXEC_PATH") bootstrap[k] = v;
    }
    localEnvVars = git(["rev-parse", "--local-env-vars"], { cwd: os.tmpdir(), env: bootstrap })
      .then((b) => b.toString("utf8").split("\n").filter(Boolean))
      .catch((e) => {
        localEnvVars = undefined;
        throw e;
      });
  }
  return localEnvVars;
}

/** @param {string} s */
function escapeGlob(s) {
  return s.replace(/[*?[\]\\]/g, "\\$&");
}

/**
 * Root-anchored glob pathspec body for one exclude entry.
 * @param {string} entry
 */
function pathspecBody(entry) {
  return entry.endsWith("/") ? `${escapeGlob(entry)}**` : entry;
}

/**
 * Paths of the mode-160000 (gitlink) entries in `git ls-files -s -z` output,
 * exactly as written on disk: records split on NUL, each at its first tab,
 * so spaces, newlines and non-ASCII bytes in a path survive unquoted.
 * @param {Buffer} out
 */
function gitlinkPaths(out) {
  /** @type {string[]} */
  const paths = [];
  for (const record of out.toString("utf8").split("\0")) {
    const tab = record.indexOf("\t");
    if (tab > 0 && record.slice(0, tab).split(" ")[0] === "160000") paths.push(record.slice(tab + 1));
  }
  return paths;
}

/**
 * The commit `HEAD` points at, for the manifest's `commit` field.
 *
 * @param {string} repoDir any directory inside the worktree
 * @returns {Promise<string | null>} the full commit id, or `null` when the repo has no commits
 * @throws {SourceTreeError} when `repoDir` is not inside a git worktree
 */
export async function headCommit(repoDir) {
  /** @type {NodeJS.ProcessEnv} */
  let env;
  try {
    env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
    for (const name of await getLocalEnvVars()) delete env[name];
    await git(["rev-parse", "--git-dir"], { cwd: repoDir, env });
  } catch (e) {
    throw new SourceTreeError(`cannot read HEAD of ${repoDir}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const out = await git(["rev-parse", "-q", "--verify", "HEAD^{commit}"], { cwd: repoDir, env });
    return out.toString("utf8").trim() || null;
  } catch {
    // `--verify -q` exits 1 silently when HEAD is unborn: a repo with no commits.
    return null;
  }
}

/**
 * The git tree of the worktree's current non-excluded content.
 *
 * Rejects with `SourceTreeError` when the finished temp index holds a gitlink
 * (mode 160000): a nested repo, tracked or not, `.git` dir or gitfile. The
 * message names every such path, repo-relative and unquoted. Symlinks (mode
 * 120000) are accepted. Nested repos under excluded roots or ignored,
 * untracked paths never reach the temp index, so they do not reject. A
 * rejected call leaves the real index, objects and worktree untouched.
 *
 * @param {string} repoDir
 * @param {{ excludes?: readonly string[] }} [options]
 * @returns {Promise<{ tree: string, excludes: string[] }>}
 */
export async function computeSourceTree(repoDir, options = {}) {
  const excludes = [...(options.excludes ?? DEFAULT_EXCLUDES)];
  for (const e of excludes) {
    if (!isValidExclude(e)) throw new SourceTreeError(`invalid exclude ${JSON.stringify(e)}`);
  }
  const fail = (/** @type {unknown} */ e) =>
    new SourceTreeError(
      `cannot compute the source tree of ${repoDir}: ${e instanceof Error ? e.message : String(e)}`,
    );

  /** @type {NodeJS.ProcessEnv} */
  let env;
  /** @type {string} */
  let top;
  /** @type {string} */
  let realObjects;
  try {
    env = { ...process.env, GIT_LITERAL_PATHSPECS: "0", GIT_OPTIONAL_LOCKS: "0" };
    for (const name of await getLocalEnvVars()) delete env[name];
    const out = await git(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-path", "objects"], {
      cwd: repoDir,
      env,
    });
    [top, realObjects] = out.toString("utf8").split("\n");
    if (!top || !realObjects) throw new Error("not inside a worktree");
  } catch (e) {
    throw fail(e);
  }

  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), TMP_PREFIX));
  try {
    const tmpObjects = path.join(tmp, "objects");
    await fs.promises.mkdir(tmpObjects);
    const tmpEnv = {
      ...env,
      GIT_INDEX_FILE: path.join(tmp, "index"),
      GIT_OBJECT_DIRECTORY: tmpObjects,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: realObjects,
    };
    const run = (/** @type {string[]} */ args, /** @type {Buffer} */ input) =>
      git(["-c", "core.fsmonitor=false", ...args], { cwd: top, env: tmpEnv, input });
    const excludeSpecs = excludes.map((e) => `:(top,glob,exclude)${pathspecBody(e)}`);
    // Exclude-only pathspecs imply the whole tree (cwd is the toplevel), and,
    // unlike an explicit positive `:/`, do not fail on a worktree with no files.
    const scope = excludeSpecs;

    // 1. Every non-ignored, non-excluded file, hashed from content.
    await run(["add", "-A", "--", ...scope]);

    // 2. Tracked-but-ignored files, read from the REAL index (no GIT_INDEX_FILE).
    const listed = await git(
      ["-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--ignored", "--exclude-standard", "--", ...scope],
      { cwd: top, env },
    );
    const present = [...new Set(listed.toString("utf8").split("\0").filter(Boolean))].filter((p) => {
      try {
        fs.lstatSync(path.join(top, p));
        return true;
      } catch {
        return false;
      }
    });
    if (present.length > 0) {
      const input = Buffer.from(present.map((p) => `${p}\0`).join(""), "utf8");
      await run(["--literal-pathspecs", "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], input);
    }

    // 3. Belt and braces: drop any excluded path that is in the temp index.
    if (excludes.length > 0) {
      const specs = excludes.map((e) => `:(top,glob)${pathspecBody(e)}`);
      await run(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...specs]);
    }

    // 4. Refuse gitlinks in the FINISHED temp index (after steps 1-3, so a
    //    gitlink that only the force-add brought in is caught too).
    const gitlinks = gitlinkPaths(await run(["ls-files", "-s", "-z"]));
    if (gitlinks.length > 0) {
      throw new Error(`nested git repositories (gitlinks) hide their content from the tree: ${gitlinks.join(", ")}`);
    }

    // 5. The tree.
    const tree = (await run(["write-tree"])).toString("utf8").trim();
    return { tree, excludes };
  } catch (e) {
    throw fail(e);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
}
