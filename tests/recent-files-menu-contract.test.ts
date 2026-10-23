/**
 * D43 WI-4 — source contract: no code path under `src/` sends a whole list to
 * the Recent Files menu.
 *
 * Cases SC-01, SC-02 of `.claude/tdd-guardian/tests-20261007-143049.md`.
 *
 * **Law**: none. Source-shape checks with no input domain; the behavioural
 * guarantee is SS-09.
 *
 * **Mocked:** nothing — real filesystem reads.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    .map((p) => join(SRC, p));
}

const rel = (abs: string) => relative(ROOT, abs).split(sep).join("/");

describe("recent files menu — source contract (D43 WI-4)", () => {
  it("SC-01 nothing references the removed command; one file calls the new one", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes("set_recent_files_menu"))
      .map(rel);
    const callers = files
      .filter((f) => readFileSync(f, "utf8").includes("sync_recent_files_menu"))
      .map(rel);
    expect(offenders).toEqual([]);
    expect(callers).toEqual(["src/services/recentFilesMenuService.ts"]);
  });

  it("SC-02 App.tsx no longer passes recentFiles to the menu and uses the refresh hook", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(app).not.toMatch(/invoke\([^)]*recentFiles/s);
    expect(app).toContain("useRecentFilesMenuRefresh(viewMode,");
  });
});
