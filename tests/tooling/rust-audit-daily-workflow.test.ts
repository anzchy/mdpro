// @vitest-environment node
/**
 * D237-WI-2: the daily `cargo audit` run (ADR-0107).
 *
 * RustSec publishes against the lockfile at any time, and ci.yml runs only for
 * pull requests, `v*` tags and manual dispatch. rust-audit-daily.yml runs the
 * same audit on master every day, as its own workflow, so a scheduled run
 * executes nothing else and ci.yml keeps no `schedule` trigger.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entry, items, job, jobIds, keys, list, scalar, stepRun, steps, topLevel } from "../support/workflowBlocks";

const WORKFLOWS = path.resolve(__dirname, "..", "..", ".github", "workflows");
const DAILY = path.join(WORKFLOWS, "rust-audit-daily.yml");
const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const CI = read(path.join(WORKFLOWS, "ci.yml"));

describe("D237-WI-2 rust-audit-daily.yml", () => {
  it("exists", () => {
    expect(fs.existsSync(DAILY)).toBe(true);
  });

  it("runs on a daily cron and by manual dispatch, never on PRs or pushes", () => {
    const on = topLevel(read(DAILY), "on");
    expect(keys(on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    const crons = items(entry(on, "schedule")?.body ?? null).map((item) => scalar(item, "cron"));
    expect(crons).toHaveLength(1);
    expect(crons[0]).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it("has one job, rust-audit, that runs cargo audit in src-tauri and is never allowed to fail", () => {
    const text = read(DAILY);
    expect(jobIds(text)).toEqual(["rust-audit"]);
    const j = job(text, "rust-audit");
    expect(list(j, "needs")).toBeNull();
    expect(scalar(j, "continue-on-error")).toBeNull();
    const audit = steps(j).find((s) => stepRun(s) === "cargo audit");
    expect(audit).toBeDefined();
    expect(scalar(audit ?? null, "working-directory")).toBe("src-tauri");
    expect(scalar(audit ?? null, "continue-on-error")).toBeNull();
  });

  it("only reads the repository", () => {
    expect(scalar(topLevel(read(DAILY), "permissions"), "contents")).toBe("read");
  });

  it("leaves ci.yml without a schedule trigger", () => {
    expect(keys(topLevel(CI, "on"))).not.toContain("schedule");
  });
});
