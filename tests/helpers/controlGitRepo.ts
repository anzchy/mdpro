/**
 * Real-git sandbox for the WI-4 (ADR-0047) `computeSourceTree` tests.
 *
 * Every repo lives under one `fs.mkdtempSync` root, and `git()` refuses a cwd
 * outside that root, so no test can run git against the mdpro checkout. The
 * child env drops every inherited `GIT_*` variable and pins config, author,
 * committer and dates, so the tests see neither the developer's git config nor
 * a hostile env a test has stubbed into `process.env` for the module.
 * `GIT_OPTIONAL_LOCKS=0` is always set, so a read (`status`) never refreshes the
 * index a snapshot is guarding.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

export const FIXED_GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "WI4 Test",
  GIT_AUTHOR_EMAIL: "wi4@example.invalid",
  GIT_COMMITTER_NAME: "WI4 Test",
  GIT_COMMITTER_EMAIL: "wi4@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

export type RepoSnapshot = {
  indexBytes: string | null;
  indexMtimeMs: number | null;
  objects: string[];
  status: string;
  stagedNames: string;
  lsFilesV: string;
};

type GitOpts = { env?: Record<string, string>; allowFail?: boolean };

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

export class GitSandbox {
  readonly root: string;
  /** Empty dir the tests point `TMPDIR` at for the leak checks. */
  readonly tmp: string;
  private readonly indexPaths = new Map<string, string>();
  private readonly objectDirs = new Map<string, string>();

  constructor() {
    this.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wi4-sourcetree-")));
    this.tmp = path.join(this.root, "TMPDIR");
    fs.mkdirSync(this.tmp);
  }

  /** Stub the module-visible git env (the matrix's "git test env"). */
  stubEnv(): void {
    for (const [k, v] of Object.entries(FIXED_GIT_ENV)) vi.stubEnv(k, v);
    vi.stubEnv("GIT_CEILING_DIRECTORIES", this.root);
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }

  private assertInside(p: string): void {
    const rel = path.relative(this.root, path.resolve(p));
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`refusing to touch ${p}: outside the sandbox ${this.root}`);
    }
  }

  dir(name: string): string {
    const p = path.join(this.root, name);
    this.assertInside(p);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  git(cwd: string, args: string[], opts: GitOpts = {}): string {
    this.assertInside(cwd);
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith("GIT_") && v !== undefined) base[k] = v;
    }
    const env = {
      ...base,
      ...FIXED_GIT_ENV,
      GIT_CEILING_DIRECTORIES: this.root,
      GIT_OPTIONAL_LOCKS: "0",
      ...opts.env,
    };
    try {
      return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      if (opts.allowFail) return "";
      throw error;
    }
  }

  write(repo: string, rel: string, content: string): void {
    const p = path.join(repo, rel);
    this.assertInside(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }

  /** `git init` only; resolves and caches the index and objects paths. */
  init(name: string, extraInitArgs: string[] = []): string {
    const repo = this.dir(name);
    this.git(repo, ["init", "-q", "-b", "main", ...extraInitArgs]);
    this.register(repo);
    return repo;
  }

  /** The matrix's `mkRepo()`: src/a.ts, src/x.ts, .gitignore = dist/, one commit. */
  mkRepo(name: string, extraInitArgs: string[] = []): string {
    const repo = this.init(name, extraInitArgs);
    this.write(repo, "src/a.ts", "A0\n");
    this.write(repo, "src/x.ts", "X0\n");
    this.write(repo, ".gitignore", "dist/\n");
    this.commitAll(repo, "base");
    return repo;
  }

  commitAll(repo: string, message: string): void {
    this.git(repo, ["add", "-A"]);
    this.git(repo, ["commit", "-q", "--allow-empty", "-m", message]);
  }

  /** Resolve the index and objects paths once, at fixture time. */
  register(repo: string): void {
    const out = this.git(repo, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
      "--git-path",
      "objects",
    ]).split("\n");
    this.indexPaths.set(repo, out[0]);
    this.objectDirs.set(repo, out[1]);
  }

  indexPath(repo: string): string {
    const p = this.indexPaths.get(repo);
    if (!p) throw new Error(`repo not registered: ${repo}`);
    return p;
  }

  oracle(repo: string): string {
    return this.git(repo, ["rev-parse", "HEAD^{tree}"]).trim();
  }

  /** Copy a repo (worktree and .git) to a new sandbox dir and register it. */
  copy(repo: string, name: string): string {
    const dest = path.join(this.root, name);
    this.assertInside(dest);
    fs.cpSync(repo, dest, { recursive: true });
    this.register(dest);
    return dest;
  }

  /**
   * The matrix's `snapshotRepo` (H3): index bytes and mtime and the object
   * list are read FIRST, before any git command; then the git reads run with
   * `GIT_OPTIONAL_LOCKS=0`.
   */
  snapshotRepo(repo: string): RepoSnapshot {
    const indexFile = this.indexPath(repo);
    const objectsDir = this.objectDirs.get(repo) as string;
    const exists = fs.existsSync(indexFile);
    const indexBytes = exists ? fs.readFileSync(indexFile).toString("base64") : null;
    const indexMtimeMs = exists ? fs.statSync(indexFile).mtimeMs : null;
    const objects = listFiles(objectsDir);
    return {
      indexBytes,
      indexMtimeMs,
      objects,
      status: this.git(repo, ["status", "--porcelain=v1", "-uall"]),
      stagedNames: this.git(repo, ["diff", "--cached", "--name-only"], { allowFail: true }),
      lsFilesV: this.git(repo, ["ls-files", "-v"]),
    };
  }
}
