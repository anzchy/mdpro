// @vitest-environment node
/**
 * D198: a commit made through `GitSandbox.git()` must not start git's detached
 * auto-maintenance. From git 2.47 on, `git commit` spawns
 * `git maintenance run --auto --detach`, which holds
 * `.git/objects/maintenance.lock` while it runs; `snapshotRepo` lists that
 * directory, so a snapshot taken meanwhile differs from the next one
 * (control-build-identity T22 on PR #432's CI). Checked with GIT_TRACE rather
 * than by catching the lock, which a fast machine never does.
 *
 * Covers the three ways the suites make a commit: a `mkRepo` fixture, a clone
 * made through `sb.git`, and a raw `sb.git(["init"])` repo.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitSandbox } from "./helpers/controlGitRepo";

let sb: GitSandbox;

beforeEach(() => {
  sb = new GitSandbox();
});

afterEach(() => {
  sb.cleanup();
});

/** One more commit in `repo`, traced to a file under sb.root; returns the trace. */
function tracedCommit(repo: string, name: string): string {
  const trace = path.join(sb.root, `${name}.trace`);
  sb.git(repo, ["commit", "-q", "--allow-empty", "-m", `traced ${name}`], { env: { GIT_TRACE: trace } });
  expect(fs.existsSync(trace), `${trace} exists`).toBe(true);
  return fs.readFileSync(trace, "utf8");
}

describe("D198 GitSandbox commits start no auto-maintenance", () => {
  it.each([
    ["a mkRepo fixture", () => sb.mkRepo("r")],
    [
      "a clone made through sb.git",
      () => {
        const origin = sb.mkRepo("origin");
        const clone = path.join(sb.root, "clone");
        sb.git(sb.root, ["clone", "-q", origin, clone]);
        return clone;
      },
    ],
    [
      "a raw sb.git init",
      () => {
        const raw = sb.dir("raw");
        sb.git(raw, ["init", "-q", "-b", "main"]);
        return raw;
      },
    ],
  ])("%s", (name, make) => {
    const trace = tracedCommit(make(), name.replace(/\W+/g, "-"));
    expect(trace, "the trace recorded the commit itself").toMatch(/built-in: git commit/);
    expect(trace).not.toMatch(/maintenance run|gc --auto/);
  });
});
